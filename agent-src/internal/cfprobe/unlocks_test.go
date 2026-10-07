package cfprobe

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// 雙端點 merge 規則（B 方案規格）：yes+yes=yes；yes+no / no+yes = partial；no+no=no；其余 = unknown。
func TestMergeAIStatus(t *testing.T) {
	cases := []struct {
		web, api, want string
	}{
		{"yes", "yes", "yes"},
		{"yes", "no", "partial"},
		{"no", "yes", "partial"},
		{"no", "no", "no"},
		{"unknown", "yes", "unknown"},
		{"yes", "unknown", "unknown"},
		{"unknown", "unknown", "unknown"},
		{"no", "unknown", "unknown"},
		{"unknown", "no", "unknown"},
	}
	for _, c := range cases {
		if got := mergeAIStatus(c.web, c.api); got != c.want {
			t.Errorf("mergeAIStatus(%q, %q) = %q, want %q", c.web, c.api, got, c.want)
		}
	}
}

// errResult 改咗由一律 "no" 變 "unknown"，timeout/DNS 錯唔應該誤報為「服务封锁」。
func TestErrResultIsUnknown(t *testing.T) {
	res := errResult(errors.New("dial tcp: i/o timeout"), 8000)
	if res.Status != "unknown" {
		t.Errorf("errResult.Status = %q, want %q", res.Status, "unknown")
	}
	if res.ServiceUsable != "unknown" {
		t.Errorf("errResult.ServiceUsable = %q, want %q", res.ServiceUsable, "unknown")
	}
	if res.Reachable {
		t.Errorf("errResult.Reachable = true, want false")
	}
}

// endpointProbe 對唔同 HTTP status / body 嘅反應。
func TestEndpointProbe(t *testing.T) {
	newServer := func(code int, body string) *httptest.Server {
		return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(code)
			_, _ = w.Write([]byte(body))
		}))
	}

	t.Run("200 OK → yes", func(t *testing.T) {
		s := newServer(200, "User-agent: *")
		defer s.Close()
		status, code, _, _ := endpointProbe(s.Client(), "GET", s.URL, nil)
		if status != "yes" || code != 200 {
			t.Errorf("got (%q, %d), want (yes, 200)", status, code)
		}
	})

	t.Run("401 → yes (auth required, endpoint reachable)", func(t *testing.T) {
		s := newServer(401, `{"error":"unauthorized"}`)
		defer s.Close()
		status, code, _, _ := endpointProbe(s.Client(), "GET", s.URL, nil)
		if status != "yes" || code != 401 {
			t.Errorf("got (%q, %d), want (yes, 401)", status, code)
		}
	})

	t.Run("405 → yes (method not allowed, endpoint reachable)", func(t *testing.T) {
		s := newServer(405, `{"error":"method not allowed"}`)
		defer s.Close()
		status, code, _, _ := endpointProbe(s.Client(), "GET", s.URL, nil)
		if status != "yes" || code != 405 {
			t.Errorf("got (%q, %d), want (yes, 405)", status, code)
		}
	})

	t.Run("403 + country → no (region blocked)", func(t *testing.T) {
		s := newServer(403, `{"error":"unsupported_country_region_territory"}`)
		defer s.Close()
		status, code, _, reason := endpointProbe(s.Client(), "GET", s.URL, nil)
		if status != "no" || code != 403 {
			t.Errorf("got (%q, %d), want (no, 403)", status, code)
		}
		if !strings.Contains(reason, "region") {
			t.Errorf("reason = %q, want contains 'region'", reason)
		}
	})

	t.Run("403 + cloudflare challenge → unknown", func(t *testing.T) {
		s := newServer(403, `<html><body>Just a moment... cf-ray: abc</body></html>`)
		defer s.Close()
		status, _, _, _ := endpointProbe(s.Client(), "GET", s.URL, nil)
		if status != "unknown" {
			t.Errorf("status = %q, want unknown (CF challenge 唔代表服務封锁)", status)
		}
	})

	t.Run("403 empty body → unknown", func(t *testing.T) {
		s := newServer(403, "")
		defer s.Close()
		status, _, _, _ := endpointProbe(s.Client(), "GET", s.URL, nil)
		if status != "unknown" {
			t.Errorf("status = %q, want unknown (echo 唔明確)", status)
		}
	})

	t.Run("403 PERMISSION_DENIED → yes (Gemini API normal response)", func(t *testing.T) {
		s := newServer(403, `{"error":{"code":403,"message":"Method doesn't allow unregistered callers","status":"PERMISSION_DENIED"}}`)
		defer s.Close()
		status, code, _, _ := endpointProbe(s.Client(), "GET", s.URL, nil)
		if status != "yes" || code != 403 {
			t.Errorf("got (%q, %d), want (yes, 403) — PERMISSION_DENIED 代表 endpoint 可達", status, code)
		}
	})

	t.Run("500 → unknown", func(t *testing.T) {
		s := newServer(500, "server error")
		defer s.Close()
		status, _, _, _ := endpointProbe(s.Client(), "GET", s.URL, nil)
		if status != "unknown" {
			t.Errorf("status = %q, want unknown", status)
		}
	})
}

// probeAIService 將 web+api merge，保留各自結果。
func TestProbeAIService(t *testing.T) {
	mk := func(webCode, apiCode int, webBody, apiBody string) (*httptest.Server, *httptest.Server) {
		web := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(webCode)
			_, _ = w.Write([]byte(webBody))
		}))
		api := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(apiCode)
			_, _ = w.Write([]byte(apiBody))
		}))
		return web, api
	}

	t.Run("web=yes api=yes → yes (両通)", func(t *testing.T) {
		web, api := mk(200, 401, "ok", "unauthorized")
		defer web.Close()
		defer api.Close()
		res := probeAIService(web.Client(), web.URL, api.URL, nil)
		if res.Status != "yes" {
			t.Errorf("Status = %q, want yes", res.Status)
		}
		if res.WebStatus != "yes" || res.APIStatus != "yes" {
			t.Errorf("Web=%q API=%q, want yes/yes", res.WebStatus, res.APIStatus)
		}
	})

	t.Run("web=yes api=no → partial", func(t *testing.T) {
		web, api := mk(200, 403, "ok", "unsupported_country")
		defer web.Close()
		defer api.Close()
		res := probeAIService(web.Client(), web.URL, api.URL, nil)
		if res.Status != "partial" {
			t.Errorf("Status = %q, want partial", res.Status)
		}
	})

	t.Run("web=no api=yes → partial", func(t *testing.T) {
		web, api := mk(403, 401, "unsupported_country", "unauthorized")
		defer web.Close()
		defer api.Close()
		res := probeAIService(web.Client(), web.URL, api.URL, nil)
		if res.Status != "partial" {
			t.Errorf("Status = %q, want partial", res.Status)
		}
	})

	t.Run("web=no api=no → no", func(t *testing.T) {
		web, api := mk(403, 403, "unsupported_country", "unsupported_country")
		defer web.Close()
		defer api.Close()
		res := probeAIService(web.Client(), web.URL, api.URL, nil)
		if res.Status != "no" {
			t.Errorf("Status = %q, want no", res.Status)
		}
		if !res.RegionBlocked {
			t.Errorf("RegionBlocked = false, want true")
		}
	})

	t.Run("web=unknown api=yes → unknown", func(t *testing.T) {
		web, api := mk(500, 401, "error", "unauthorized")
		defer web.Close()
		defer api.Close()
		res := probeAIService(web.Client(), web.URL, api.URL, nil)
		if res.Status != "unknown" {
			t.Errorf("Status = %q, want unknown", res.Status)
		}
	})
}
