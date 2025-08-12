// Minimal OpenTelemetry Web init for browser traces (Signoz-like setup)
import { WebTracerProvider } from 'https://esm.sh/@opentelemetry/sdk-trace-web@1.23.0';
import { BatchSpanProcessor } from 'https://esm.sh/@opentelemetry/sdk-trace-base@1.23.0';
import { OTLPTraceExporter } from 'https://esm.sh/@opentelemetry/exporter-trace-otlp-http@0.48.0';
import { Resource } from 'https://esm.sh/@opentelemetry/resources@1.23.0';
import { SemanticResourceAttributes } from 'https://esm.sh/@opentelemetry/semantic-conventions@1.23.0';
import { ZoneContextManager } from 'https://esm.sh/@opentelemetry/context-zone@1.23.0';
import { registerInstrumentations } from 'https://esm.sh/@opentelemetry/instrumentation@0.48.0';
import { DocumentLoadInstrumentation } from 'https://esm.sh/@opentelemetry/instrumentation-document-load@0.48.0';
import { UserInteractionInstrumentation } from 'https://esm.sh/@opentelemetry/instrumentation-user-interaction@0.48.0';
import { FetchInstrumentation } from 'https://esm.sh/@opentelemetry/instrumentation-fetch@0.48.0';
import { XMLHttpRequestInstrumentation } from 'https://esm.sh/@opentelemetry/instrumentation-xml-http-request@0.48.0';
import * as api from 'https://esm.sh/@opentelemetry/api@1.7.0';

const BACKEND_ORIGIN = window.location.origin;
// Use same-origin proxy paths to avoid CORS/mixed-content
const OTLP_BASE = `${BACKEND_ORIGIN}/otel`;

const provider = new WebTracerProvider({
	resource: new Resource({
		[SemanticResourceAttributes.SERVICE_NAME]: 'paypal-microfrontend',
		[SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]: 'dev',
	}),
});

provider.addSpanProcessor(new BatchSpanProcessor(new OTLPTraceExporter({ url: `${OTLP_BASE}/v1/traces` })));
provider.register({ contextManager: new ZoneContextManager() });

registerInstrumentations({
	instrumentations: [
		new DocumentLoadInstrumentation(),
		new UserInteractionInstrumentation(),
		new FetchInstrumentation({
			propagateTraceHeaderCorsUrls: [BACKEND_ORIGIN],
			ignoreUrls: [/\/assets\//, /\/favicon\.ico$/, new RegExp(`${OTLP_BASE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`)],
			clearTimingResources: true,
		}),
		new XMLHttpRequestInstrumentation({ propagateTraceHeaderCorsUrls: [BACKEND_ORIGIN] }),
	],
});

// capture unhandled errors as spans
window.addEventListener('error', (e) => {
	const tracer = api.trace.getTracer('ui');
	const span = tracer.startSpan('window.error');
	span.recordException(e.error || e.message);
	span.setAttribute('error', true);
	span.end();
});

// global helper for manual spans in app code
globalThis.__otelTracer = () => api.trace.getTracer('ui');
