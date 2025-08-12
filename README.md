## In-Class Task 5: PayPal component with OpenTelemetry

This repo runs a simple FastAPI server that serves a PayPal button microfrontend and instruments both browser and backend with OpenTelemetry, exporting to an OTLP HTTP collector (your TrueNAS via Cloudflare).

### Requirements checklist
- Expose HTTP interface to OTEL Collector on TrueNAS with Cloudflare (5)
- Instrument `index.js` (browser) to send metrics, exceptions, traces, and logs (5)
- Instrument `app.py` (FastAPI) to trace, meter, and log to your NAS (5)

### Quick start (local)
```powershell
pip install -r requirements.txt
$env:PAYPAL_CLIENT_ID="<your client id>"; $env:PAYPAL_CLIENT_SECRET="<your client secret>"
# Point to your collector (Cloudflare URL or local)
$env:OTEL_EXPORTER_OTLP_ENDPOINT="https://<your-otel-domain>"  # or http://localhost:4318
python app.py
```
Open http://localhost:8080 and use the PayPal button component.

### Docker
```powershell
docker build -t paypal-otel .
docker run -p 8084:8080 -e PAYPAL_CLIENT_ID=... -e PAYPAL_CLIENT_SECRET=... -e OTEL_EXPORTER_OTLP_ENDPOINT=https://<your-otel-domain> paypal-otel
```

### What we instrumented
- Backend (`app.py`):
	- OTEL traces: FastAPI auto-instrumented + manual spans around order creation/capture.
	- Metrics: http_requests_total, http_request_duration_ms.
	- Logs: exported via OTLP HTTP.
	- Config endpoint `/otel-config` for the browser.

- Browser (`otel-browser.js` + `index.js`):
	- Web tracer provider with Fetch/XMLHttpRequest instrumentation.
	- Metrics via OTLP HTTP (periodic reader).
	- Logs via OTLP HTTP.
	- Basic counters: paypal_button_renders, paypal_button_clicks, and spans around createOrder/onApprove.

### Collector on TrueNAS + Cloudflare
1) Install/OpenTelemetry Collector (binary or container) on TrueNAS with OTLP HTTP receiver:

Example `otelcol-config.yaml`:
```yaml
receivers:
	otlp:
		protocols:
			http:
				endpoint: 0.0.0.0:4318

exporters:
	logging: {}
	# Example SigNoz/Tempo/OTel backends here

service:
	pipelines:
		traces:
			receivers: [otlp]
			exporters: [logging]
		metrics:
			receivers: [otlp]
			exporters: [logging]
		logs:
			receivers: [otlp]
			exporters: [logging]
```

2) Expose via Cloudflare Tunnel to a public domain, e.g. `https://otel.yourdomain.com` that forwards to TrueNAS `http://<truenas-ip>:4318`.
	 - Ensure CORS is allowed for your site origins if needed.

3) Set the environment variable in your app:
```
OTEL_EXPORTER_OTLP_ENDPOINT=https://otel.yourdomain.com
```

### Browser instrumentation reference
We followed the approach in the Signoz article: https://signoz.io/blog/opentelemetry-browser-instrumentation/

### Endpoints
- `/clientid` -> returns PayPal client id
- `/orders` -> creates a PayPal order
- `/capture/{order_id}` -> captures order
- `/otel-config` -> returns `{ otlpHttpEndpoint, serviceName }` for browser SDK
- Static site served from `/`

### Notes
- Replace `<your-otel-domain>` and PayPal credentials before running.
- If using self-hosted collector with HTTPS, ensure certificates are valid for browser.
- If testing locally, set `OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318` and run a local collector.
