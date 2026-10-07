package cfprobe

import (
	"context"
	"crypto/tls"
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"
	"time"
)

type ServiceUnlockResult struct {
	Status           string `json:"status"`            // "yes", "no", "partial", "unknown", "error"
	Region           string `json:"region,omitempty"`  // "us", "hk", "jp", "region_blocked", etc.
	Latency          int    `json:"latency"`           // TCP/HTTP RTT in ms (max of web/api)
	Reachable        bool   `json:"reachable"`         // L1/L2: TCP/TLS/HTTP Endpoint reached
	RegionBlocked    bool   `json:"region_blocked"`     // L3: Explicitly confirmed region restriction
	AuthRequired     bool   `json:"auth_required"`      // L4: HTTP 401/403 requiring credentials
	ServiceUsable    string `json:"service_usable"`    // "yes", "no", "unknown"
	RawHTTPStatus    int    `json:"raw_http_status"`   // Auditable raw HTTP status code
	Reason           string `json:"reason,omitempty"`  // Diagnostic reason
	// B 方案：AI 服务（ChatGPT/Claude/Gemini）雙端點細分。
	// Web / API 係各自獨立探測嘅 HTTP status code 同 yes/no/unknown 判定；
	// 最終 Status 由 mergeAIStatus 按「yes+yes=yes, yes+no|no+yes=partial, no+no=no, 其他=unknown」推導。
	// YouTube/Netflix/Disney 冇呢兩個 field，向後相容。
	WebCode   int    `json:"web_code,omitempty"`   // web 端點 raw HTTP status
	WebStatus string `json:"web_status,omitempty"` // web 端點判定：yes/no/unknown
	APICode   int    `json:"api_code,omitempty"`   // api 端點 raw HTTP status
	APIStatus string `json:"api_status,omitempty"` // api 端點判定：yes/no/unknown
}

type UnlockSnapshot struct {
	YouTube ServiceUnlockResult `json:"youtube"`
	Netflix ServiceUnlockResult `json:"netflix"`
	Disney  ServiceUnlockResult `json:"disney"`
	ChatGPT ServiceUnlockResult `json:"chatgpt"`
	Claude  ServiceUnlockResult `json:"claude"`
	Gemini  ServiceUnlockResult `json:"gemini"`
}

const unlockTimeout = 8 * time.Second

const browserUA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

func newUnlockClient() *http.Client {
	return &http.Client{
		Timeout: unlockTimeout,
		Transport: &http.Transport{
			Proxy: http.ProxyFromEnvironment,
			DialContext: (&net.Dialer{
				Timeout:   unlockTimeout,
				KeepAlive: 30 * time.Second,
			}).DialContext,
			TLSClientConfig: &tls.Config{
				InsecureSkipVerify: false,
			},
			DisableKeepAlives: true,
		},
		// Cap redirects: >3 hops is usually a challenge/blocked loop.
		// Return the last response so we can inspect the final status code.
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 3 {
				return http.ErrUseLastResponse
			}
			return nil
		},
	}
}

// readBody reads up to N bytes from a response body and closes it.
func readBody(resp *http.Response, limit int64) string {
	defer resp.Body.Close()
	b, _ := io.ReadAll(io.LimitReader(resp.Body, limit))
	return string(b)
}

// errResult returns UNKNOWN status for a failed HTTP call.
// 之前返回 "no" 會將 timeout/DNS/TLS 失敗誤報為「服务封锁」，B 方案改成 "unknown"，
// 由前端顯示「待驗證」。Diagnostic info carried in Reason.
func errResult(err error, latencyMs int) ServiceUnlockResult {
	errMsg := ""
	if err != nil {
		errMsg = err.Error()
	}
	return ServiceUnlockResult{
		Status:        "unknown",
		Latency:       latencyMs,
		Reason:        errMsg,
		Reachable:     false,
		RegionBlocked: false,
		AuthRequired:  false,
		ServiceUsable: "unknown",
	}
}

// mergeAIStatus merges web/api probe outcomes into the final unlock status.
// 規則（B 方案规格）：yes+yes=yes；yes+no / no+yes = partial；no+no=no；其余 = unknown。
func mergeAIStatus(web, api string) string {
	if web == "yes" && api == "yes" {
		return "yes"
	}
	if web == "no" && api == "no" {
		return "no"
	}
	if (web == "yes" && api == "no") || (web == "no" && api == "yes") {
		return "partial"
	}
	return "unknown"
}

// endpointProbe 係對單一 URL 發 GET，根據 statusCode / body / err 推導 yes/no/unknown。
// 所有 AI 雙端點都用同一套判斷規則：
//   - err (DNS/TLS/timeout)                        → unknown
//   - 2xx / 401 / 405                              → yes（端點可達，認證/方法唔影響可達性）
//   - 403 + region/country/unsupported in body     → no（明確地區封鎖）
//   - 403 + cloudflare challenge                   → unknown（WAF 擋 probe，唔代表用户用唔到）
//   - 其他 4xx/5xx                                 → unknown（狀態唔明確）
func endpointProbe(client *http.Client, method, url string, headers map[string]string) (status string, httpCode int, latencyMs int, reason string) {
	t0 := time.Now()
	req, err := http.NewRequestWithContext(context.Background(), method, url, nil)
	if err != nil {
		return "unknown", 0, 0, err.Error()
	}
	req.Header.Set("User-Agent", "curl/8.5.0")
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	resp, err := client.Do(req)
	latencyMs = int(time.Since(t0).Milliseconds())
	if err != nil {
		return "unknown", 0, latencyMs, err.Error()
	}
	httpCode = resp.StatusCode
	body := readBody(resp, 32*1024)

	switch {
	case httpCode >= 200 && httpCode < 300, httpCode == 401, httpCode == 405:
		return "yes", httpCode, latencyMs, "endpoint reachable"
	case httpCode == 403 && strings.Contains(body, "PERMISSION_DENIED"):
		// Google API 喺無 credential 時回 403 PERMISSION_DENIED，
		// 代表 endpoint 可達但要 auth — 端點層面視為 yes。
		return "yes", httpCode, latencyMs, "endpoint reachable (auth required)"
	case httpCode == 403:
		if strings.Contains(body, "country") ||
			strings.Contains(body, "unsupported_country") ||
			strings.Contains(body, "unsupportedCountry") ||
			strings.Contains(body, "region") ||
			strings.Contains(body, "geoblocked") {
			return "no", httpCode, latencyMs, "region blocked"
		}
		if isCloudflareBlocked(httpCode, body) {
			return "unknown", httpCode, latencyMs, "cloudflare challenge"
		}
		return "unknown", httpCode, latencyMs, "forbidden (no explicit geo signal)"
	default:
		return "unknown", httpCode, latencyMs, fmt.Sprintf("unexpected http %d", httpCode)
	}
}

// probeAIService 探 web + api 兩個端點，merge 出最終 Status。
// WebStatus / APIStatus 各自保留，Status 係 merge 結果。
func probeAIService(client *http.Client, webURL, apiURL string, apiHeaders map[string]string) ServiceUnlockResult {
	webStatus, webCode, webLatency, webReason := endpointProbe(client, "GET", webURL, nil)
	apiStatus, apiCode, apiLatency, apiReason := endpointProbe(client, "GET", apiURL, apiHeaders)

	// Latency：取兩者較慢嗰個作為整體體感延遲（嚴謹：較差情況）。
	latency := webLatency
	if apiLatency > latency {
		latency = apiLatency
	}

	finalStatus := mergeAIStatus(webStatus, apiStatus)

	res := ServiceUnlockResult{
		Status:        finalStatus,
		Latency:       latency,
		Reachable:     webCode > 0 || apiCode > 0,
		RawHTTPStatus: apiCode, // 保留 API code 作為主 raw_http_status 兼容舊前端
		WebCode:       webCode,
		WebStatus:     webStatus,
		APICode:       apiCode,
		APIStatus:     apiStatus,
	}

	// Reason：組合 web/api 短描述，方便 log/日後 diag。
	res.Reason = fmt.Sprintf("web=%s(%d %s) api=%s(%d %s)",
		webStatus, webCode, webReason,
		apiStatus, apiCode, apiReason)

	switch finalStatus {
	case "yes":
		res.ServiceUsable = "yes"
		res.RegionBlocked = false
		res.AuthRequired = (apiCode == 401 || apiCode == 405)
	case "no":
		res.ServiceUsable = "no"
		res.RegionBlocked = true
		res.Region = "region_blocked"
	case "partial":
		res.ServiceUsable = "unknown" // 唔好武斷話整部 VPS 用唔用得到
		res.RegionBlocked = false
	case "unknown":
		res.ServiceUsable = "unknown"
	}
	return res
}

// isCloudflareBlocked detects Cloudflare anti-bot responses.
func isCloudflareBlocked(statusCode int, body string) bool {
	if statusCode == 403 || statusCode == 429 || statusCode == 503 {
		if strings.Contains(body, "Just a moment") ||
			strings.Contains(body, "cf-ray") ||
			strings.Contains(body, "cf_details") ||
			strings.Contains(body, "blocked") {
			return true
		}
	}
	return false
}

func checkYouTube(client *http.Client) ServiceUnlockResult {
	t0 := time.Now()
	req, err := http.NewRequestWithContext(context.Background(), "GET", "https://www.youtube.com/premium", nil)
	if err != nil {
		return errResult(err, 0)
	}
	req.Header.Set("User-Agent", browserUA)
	req.Header.Set("Accept-Language", "en-US,en;q=0.9")

	resp, err := client.Do(req)
	latency := int(time.Since(t0).Milliseconds())
	if err != nil {
		return errResult(err, latency)
	}
	body := readBody(resp, 1024*256)

	// Extract region
	region := ""
	if idx := strings.Index(body, `"countryCode":"`); idx != -1 {
		sub := body[idx+len(`"countryCode":"`):]
		if end := strings.Index(sub, `"`); end != -1 {
			region = strings.ToLower(sub[:end])
		}
	}

	// Explicit success: 200 with real page content (not blocked)
	if resp.StatusCode == 200 && !isCloudflareBlocked(resp.StatusCode, body) {
		// Premium unavailable message means region is blocked
		if strings.Contains(body, "Premium is not available in your country") {
			return ServiceUnlockResult{Status: "no", Region: region, Latency: latency}
		}
		return ServiceUnlockResult{Status: "yes", Region: region, Latency: latency}
	}
	// Everything else is explicitly NO
	return ServiceUnlockResult{Status: "no", Region: region, Latency: latency}
}

func checkNetflix(client *http.Client) ServiceUnlockResult {
	t0 := time.Now()
	// Non-original title test: title/80018499 is a real licensed title.
	req, err := http.NewRequestWithContext(context.Background(), "GET", "https://www.netflix.com/title/80018499", nil)
	if err != nil {
		return errResult(err, 0)
	}
	req.Header.Set("User-Agent", browserUA)
	resp, err := client.Do(req)
	latency := int(time.Since(t0).Milliseconds())
	if err != nil {
		return errResult(err, latency)
	}
	body := readBody(resp, 1024*64)

	if resp.StatusCode == 200 && !isCloudflareBlocked(resp.StatusCode, body) {
		return ServiceUnlockResult{Status: "yes", Latency: latency}
	}
	// 403/404 with a non-blocked response usually means geo-block of licensed
	// content but Netflix originals may still work. Report as partial.
	if resp.StatusCode == 403 || resp.StatusCode == 404 {
		return ServiceUnlockResult{Status: "partial", Latency: latency}
	}
	return ServiceUnlockResult{Status: "no", Latency: latency}
}

func checkDisney(client *http.Client) ServiceUnlockResult {
	t0 := time.Now()
	req, err := http.NewRequestWithContext(context.Background(), "GET", "https://www.disneyplus.com/", nil)
	if err != nil {
		return errResult(err, 0)
	}
	req.Header.Set("User-Agent", browserUA)
	resp, err := client.Do(req)
	latency := int(time.Since(t0).Milliseconds())
	if err != nil {
		return errResult(err, latency)
	}
	body := readBody(resp, 1024*64)

	// Only accept 200 from disneyplus.com itself (not a redirect target,
	// not a challenge page). Redirects are already followed by client.
	if resp.StatusCode == 200 && !isCloudflareBlocked(resp.StatusCode, body) {
		return ServiceUnlockResult{Status: "yes", Latency: latency}
	}
	return ServiceUnlockResult{Status: "no", Latency: latency}
}

// checkChatGPT: B 方案雙端點 — web(chatgpt.com) + api(api.openai.com)，merge 出最終 Status。
func checkChatGPT(client *http.Client) ServiceUnlockResult {
	return probeAIService(client,
		"https://chatgpt.com/robots.txt",
		"https://api.openai.com/v1/models",
		nil,
	)
}

// checkClaude: B 方案雙端點 — web(claude.ai) + api(api.anthropic.com)。
func checkClaude(client *http.Client) ServiceUnlockResult {
	return probeAIService(client,
		"https://claude.ai/robots.txt",
		"https://api.anthropic.com/v1/messages",
		map[string]string{"anthropic-version": "2023-06-01"},
	)
}

// checkGemini: B 方案雙端點 — web(gemini.google.com) + api(generativelanguage.googleapis.com)。
func checkGemini(client *http.Client) ServiceUnlockResult {
	return probeAIService(client,
		"https://gemini.google.com/robots.txt",
		"https://generativelanguage.googleapis.com/v1beta/models",
		nil,
	)
}

func ProbeAllUnlocks(log logger) UnlockSnapshot {
	client := newUnlockClient()
	snap := UnlockSnapshot{
		YouTube: checkYouTube(client),
		Netflix: checkNetflix(client),
		Disney:  checkDisney(client),
		ChatGPT: checkChatGPT(client),
		Claude:  checkClaude(client),
		Gemini:  checkGemini(client),
	}
	log.debugf("Unlocks probed: YT=%s(%dms) NF=%s(%dms) DP=%s(%dms) GPT=%s(%dms) Claude=%s(%dms) Gemini=%s(%dms)",
		snap.YouTube.Status, snap.YouTube.Latency,
		snap.Netflix.Status, snap.Netflix.Latency,
		snap.Disney.Status, snap.Disney.Latency,
		snap.ChatGPT.Status, snap.ChatGPT.Latency,
		snap.Claude.Status, snap.Claude.Latency,
		snap.Gemini.Status, snap.Gemini.Latency,
	)
	return snap
}
