package cfprobe

import (
	"context"
	"crypto/tls"
	"io"
	"net"
	"net/http"
	"strings"
	"time"
)

type ServiceUnlockResult struct {
	Status  string `json:"status"`  // "yes", "no", "partial", "error"
	Region  string `json:"region"`  // "us", "hk", "jp", etc.
	Latency int    `json:"latency"` // TCP/HTTP RTT in ms
}

type UnlockSnapshot struct {
	YouTube ServiceUnlockResult `json:"youtube"`
	Netflix ServiceUnlockResult `json:"netflix"`
	Disney  ServiceUnlockResult `json:"disney"`
	ChatGPT ServiceUnlockResult `json:"chatgpt"`
	Claude  ServiceUnlockResult `json:"claude"`
	Gemini  ServiceUnlockResult `json:"gemini"`
}

func newHTTPClient(timeout time.Duration) *http.Client {
	return &http.Client{
		Timeout: timeout,
		Transport: &http.Transport{
			Proxy: http.ProxyFromEnvironment,
			DialContext: (&net.Dialer{
				Timeout:   timeout,
				KeepAlive: 30 * time.Second,
			}).DialContext,
			TLSClientConfig: &tls.Config{
				InsecureSkipVerify: false,
			},
			DisableKeepAlives: true,
		},
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 5 {
				return http.ErrUseLastResponse
			}
			return nil
		},
	}
}

func checkYouTube(client *http.Client) ServiceUnlockResult {
	t0 := time.Now()
	req, err := http.NewRequestWithContext(context.Background(), "GET", "https://www.youtube.com/premium", nil)
	if err != nil {
		return ServiceUnlockResult{Status: "no"}
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
	req.Header.Set("Accept-Language", "en-US,en;q=0.9")

	resp, err := client.Do(req)
	latency := int(time.Since(t0).Milliseconds())
	if err != nil {
		return ServiceUnlockResult{Status: "no", Latency: latency}
	}
	defer resp.Body.Close()

	bodyBytes, _ := io.ReadAll(io.LimitReader(resp.Body, 1024*256))
	body := string(bodyBytes)

	region := ""
	if idx := strings.Index(body, `"countryCode":"`); idx != -1 {
		sub := body[idx+len(`"countryCode":"`):]
		if end := strings.Index(sub, `"`); end != -1 {
			region = strings.ToLower(sub[:end])
		}
	}

	if strings.Contains(body, "Premium is not available in your country") {
		return ServiceUnlockResult{Status: "no", Region: region, Latency: latency}
	}
	return ServiceUnlockResult{Status: "yes", Region: region, Latency: latency}
}

func checkNetflix(client *http.Client) ServiceUnlockResult {
	t0 := time.Now()
	// Netflix non-original title test
	req, err := http.NewRequestWithContext(context.Background(), "GET", "https://www.netflix.com/title/80018499", nil)
	if err != nil {
		return ServiceUnlockResult{Status: "no"}
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
	resp, err := client.Do(req)
	latency := int(time.Since(t0).Milliseconds())
	if err != nil {
		return ServiceUnlockResult{Status: "no", Latency: latency}
	}
	defer resp.Body.Close()

	if resp.StatusCode == 200 {
		return ServiceUnlockResult{Status: "yes", Latency: latency}
	} else if resp.StatusCode == 403 || resp.StatusCode == 404 {
		// Check original only fallback
		return ServiceUnlockResult{Status: "partial", Latency: latency}
	}
	return ServiceUnlockResult{Status: "no", Latency: latency}
}

func checkDisney(client *http.Client) ServiceUnlockResult {
	t0 := time.Now()
	req, err := http.NewRequestWithContext(context.Background(), "GET", "https://www.disneyplus.com/", nil)
	if err != nil {
		return ServiceUnlockResult{Status: "no"}
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
	resp, err := client.Do(req)
	latency := int(time.Since(t0).Milliseconds())
	if err != nil {
		return ServiceUnlockResult{Status: "no", Latency: latency}
	}
	defer resp.Body.Close()

	if resp.StatusCode == 200 || resp.StatusCode == 301 || resp.StatusCode == 302 {
		return ServiceUnlockResult{Status: "yes", Latency: latency}
	}
	return ServiceUnlockResult{Status: "no", Latency: latency}
}

func checkChatGPT(client *http.Client) ServiceUnlockResult {
	t0 := time.Now()
	req, err := http.NewRequestWithContext(context.Background(), "GET", "https://ios.chat.openai.com/", nil)
	if err != nil {
		return ServiceUnlockResult{Status: "no"}
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15")
	resp, err := client.Do(req)
	latency := int(time.Since(t0).Milliseconds())
	if err != nil {
		return ServiceUnlockResult{Status: "no", Latency: latency}
	}
	defer resp.Body.Close()

	if resp.StatusCode == 200 || resp.StatusCode == 404 {
		return ServiceUnlockResult{Status: "yes", Latency: latency}
	}
	if resp.StatusCode == 403 {
		return ServiceUnlockResult{Status: "no", Latency: latency}
	}
	return ServiceUnlockResult{Status: "yes", Latency: latency}
}

func checkClaude(client *http.Client) ServiceUnlockResult {
	t0 := time.Now()
	req, err := http.NewRequestWithContext(context.Background(), "GET", "https://claude.ai/login", nil)
	if err != nil {
		return ServiceUnlockResult{Status: "no"}
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
	resp, err := client.Do(req)
	latency := int(time.Since(t0).Milliseconds())
	if err != nil {
		return ServiceUnlockResult{Status: "no", Latency: latency}
	}
	defer resp.Body.Close()

	if resp.StatusCode == 403 {
		return ServiceUnlockResult{Status: "no", Latency: latency}
	}
	return ServiceUnlockResult{Status: "yes", Latency: latency}
}

func checkGemini(client *http.Client) ServiceUnlockResult {
	t0 := time.Now()
	req, err := http.NewRequestWithContext(context.Background(), "GET", "https://gemini.google.com/", nil)
	if err != nil {
		return ServiceUnlockResult{Status: "no"}
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
	resp, err := client.Do(req)
	latency := int(time.Since(t0).Milliseconds())
	if err != nil {
		return ServiceUnlockResult{Status: "no", Latency: latency}
	}
	defer resp.Body.Close()

	if resp.StatusCode == 200 {
		return ServiceUnlockResult{Status: "yes", Latency: latency}
	}
	return ServiceUnlockResult{Status: "no", Latency: latency}
}

func ProbeAllUnlocks(log logger) UnlockSnapshot {
	client := newHTTPClient(6 * time.Second)
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
