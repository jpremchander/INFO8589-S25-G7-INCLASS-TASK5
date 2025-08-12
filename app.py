import uvicorn
from fastapi import FastAPI, Request, Response
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
import os
import logging
import httpx

from paypalserversdk.http.auth.o_auth_2 import ClientCredentialsAuthCredentials

from paypalserversdk.logging.configuration.api_logging_configuration import (

    LoggingConfiguration,

    RequestLoggingConfiguration,

    ResponseLoggingConfiguration,

)

from paypalserversdk.paypal_serversdk_client import PaypalServersdkClient

from paypalserversdk.controllers.orders_controller import OrdersController

from paypalserversdk.controllers.payments_controller import PaymentsController

from paypalserversdk.models.amount_with_breakdown import AmountWithBreakdown

from paypalserversdk.models.checkout_payment_intent import CheckoutPaymentIntent

from paypalserversdk.models.order_request import OrderRequest

from paypalserversdk.models.capture_request import CaptureRequest

from paypalserversdk.models.money import Money

from paypalserversdk.models.shipping_details import ShippingDetails

from paypalserversdk.models.shipping_option import ShippingOption

from paypalserversdk.models.shipping_type import ShippingType

from paypalserversdk.models.purchase_unit_request import PurchaseUnitRequest

from paypalserversdk.models.payment_source import PaymentSource

from paypalserversdk.models.card_request import CardRequest

from paypalserversdk.models.card_attributes import CardAttributes

from paypalserversdk.models.card_verification import CardVerification

from paypalserversdk.api_helper import ApiHelper



from opentelemetry import trace, metrics
from opentelemetry.sdk.resources import Resource
from opentelemetry.semconv.resource import ResourceAttributes
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
from opentelemetry.instrumentation.requests import RequestsInstrumentor
from opentelemetry.sdk.metrics import MeterProvider
from opentelemetry.exporter.otlp.proto.http.metric_exporter import OTLPMetricExporter
from opentelemetry.sdk.metrics.export import PeriodicExportingMetricReader
from opentelemetry.sdk._logs import LoggerProvider, LoggingHandler, BatchLogRecordProcessor
from opentelemetry.exporter.otlp.proto.http._log_exporter import OTLPLogExporter

load_dotenv()
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("app")

app = FastAPI(title="PayPal + FastAPI + OTel")

origins = [
    "*"
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------- OpenTelemetry setup (backend) ----------
OTLP_BASE = os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://localhost:4318")
OTLP_TRACES_URL = os.getenv("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT", f"{OTLP_BASE}/v1/traces")
OTLP_METRICS_URL = os.getenv("OTEL_EXPORTER_OTLP_METRICS_ENDPOINT", f"{OTLP_BASE}/v1/metrics")
OTLP_LOGS_URL = os.getenv("OTEL_EXPORTER_OTLP_LOGS_ENDPOINT", f"{OTLP_BASE}/v1/logs")

resource = Resource.create({
    ResourceAttributes.SERVICE_NAME: "fastapi-paypal-backend",
    ResourceAttributes.DEPLOYMENT_ENVIRONMENT: os.getenv("DEPLOY_ENV", "dev"),
})

provider = TracerProvider(resource=resource)
provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter(endpoint=OTLP_TRACES_URL)))
trace.set_tracer_provider(provider)

# Auto-instrument FastAPI and outbound requests (used by PayPal SDK)
FastAPIInstrumentor.instrument_app(app)
RequestsInstrumentor().instrument()

# Metrics
metric_reader = PeriodicExportingMetricReader(OTLPMetricExporter(endpoint=OTLP_METRICS_URL))
meter_provider = MeterProvider(resource=resource, metric_readers=[metric_reader])
metrics.set_meter_provider(meter_provider)
meter = metrics.get_meter("paypal")
orders_created = meter.create_counter("orders.created", description="Number of PayPal orders created")
orders_captured = meter.create_counter("orders.captured", description="Number of PayPal orders captured")
ui_events = meter.create_counter("ui.events", description="Generic UI events/metrics from browser")

# Logs → OTLP
log_provider = LoggerProvider(resource=resource)
log_provider.add_log_record_processor(BatchLogRecordProcessor(OTLPLogExporter(endpoint=OTLP_LOGS_URL)))
otel_handler = LoggingHandler(level=logging.INFO, logger_provider=log_provider)
logging.getLogger().addHandler(otel_handler)


@app.get("/clientid")
async def clientid():
    return {"clientid": os.environ.get('PAYPAL_CLIENT_ID', '')}

paypal_client: PaypalServersdkClient = PaypalServersdkClient(

    client_credentials_auth_credentials=ClientCredentialsAuthCredentials(

        o_auth_client_id=os.getenv("PAYPAL_CLIENT_ID"),

        o_auth_client_secret=os.getenv("PAYPAL_CLIENT_SECRET"),

    ),

    logging_configuration=LoggingConfiguration(

        log_level=logging.INFO,

        # Disable masking of sensitive headers for Sandbox testing.

        # This should be set to True (the default if unset)in production.

        mask_sensitive_headers=False,

        request_logging_config=RequestLoggingConfiguration(

            log_headers=True, log_body=True

        ),

        response_logging_config=ResponseLoggingConfiguration(

            log_headers=True, log_body=True

        ),

    ),

)


orders_controller: OrdersController = paypal_client.orders
payments_controller: PaymentsController = paypal_client.payments

@app.post("/orders")
async def create_order(request: Request):
    tracer = trace.get_tracer("paypal")
    with tracer.start_as_current_span("orders.create") as span:
        body = await request.json()
        try:
            cart = body.get("cart", [])
            # default fallback if missing currency/amount
            currency = cart[0].get("currency", "USD") if cart else "USD"
            amount = cart[0].get("amount", "1.00") if cart else "1.00"
            span.set_attribute("order.currency", currency)
            span.set_attribute("order.amount", amount)
            logger.info("Creating order", extra={"order.currency": currency, "order.amount": amount})

            order = orders_controller.orders_create({
                "body": OrderRequest(
                    intent=CheckoutPaymentIntent.CAPTURE,
                    purchase_units=[
                        PurchaseUnitRequest(
                            amount=AmountWithBreakdown(
                                currency_code=currency,
                                value=amount,
                            ),
                        )
                    ],
                )
            })
            orders_created.add(1, {"currency": currency})
            return order.body
        except Exception as e:
            span.record_exception(e)
            span.set_attribute("error", True)
            logger.exception("Order creation failed")
            raise

@app.post("/capture/{order_id}")
def capture_order(order_id: str):
    tracer = trace.get_tracer("paypal")
    with tracer.start_as_current_span("orders.capture") as span:
        span.set_attribute("order.id", order_id)
        try:
            order = orders_controller.orders_capture({"id": order_id, "prefer": "return=representation"})
            orders_captured.add(1)
            logger.info("Order captured", extra={"order.id": order_id})
            return order.body
        except Exception as e:
            span.record_exception(e)
            span.set_attribute("error", True)
            logger.exception("Order capture failed", extra={"order.id": order_id})
            raise


# ---------- OTLP proxy for browser (same-origin) ----------
COLLECTOR_TRACES = os.getenv("OTEL_COLLECTOR_PROXY_TARGET", OTLP_TRACES_URL)

@app.post("/otel/v1/traces")
async def otel_proxy(request: Request):
    body = await request.body()
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.post(
                COLLECTOR_TRACES,
                content=body,
                headers={"Content-Type": "application/json"},
            )
        return Response(
            content=r.content,
            status_code=r.status_code,
            media_type=r.headers.get("content-type", "application/json"),
        )
    except Exception as e:
        logger.exception("OTLP proxy failed")
        return Response(content=str(e), status_code=500)

@app.post("/otel/v1/metrics")
async def otel_metrics_proxy(request: Request):
    body = await request.body()
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.post(
                OTLP_METRICS_URL,
                content=body,
                headers={"Content-Type": "application/json"},
            )
        return Response(
            content=r.content,
            status_code=r.status_code,
            media_type=r.headers.get("content-type", "application/json"),
        )
    except Exception as e:
        logger.exception("OTLP metrics proxy failed")
        return Response(content=str(e), status_code=500)

@app.post("/otel/v1/logs")
async def otel_logs_proxy(request: Request):
    body = await request.body()
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.post(
                OTLP_LOGS_URL,
                content=body,
                headers={"Content-Type": "application/json"},
            )
        return Response(
            content=r.content,
            status_code=r.status_code,
            media_type=r.headers.get("content-type", "application/json"),
        )
    except Exception as e:
        logger.exception("OTLP logs proxy failed")
        return Response(content=str(e), status_code=500)

# ---------- Basic UI metrics & logs (optional) ----------
@app.post("/ui/metric")
async def ui_metric(request: Request):
    data = await request.json()
    name = data.get("name", "ui.metric")
    value = float(data.get("value", 1))
    attrs = data.get("attrs", {})
    # Map a few known names to counters
    if name == "orders.created":
        orders_created.add(value, attrs)
    elif name == "orders.captured":
        orders_captured.add(value, attrs)
    logger.info("ui.metric", extra={"metric": name, "value": value, **attrs})
    return {"ok": True}

@app.post("/ui/log")
async def ui_log(request: Request):
    data = await request.json()
    level = str(data.get("level", "info")).lower()
    msg = data.get("message", "ui.log")
    extra = data.get("extra", {})
    if level == "error":
        logger.error(msg, extra=extra)
    elif level == "warn" or level == "warning":
        logger.warning(msg, extra=extra)
    else:
        logger.info(msg, extra=extra)
    return {"ok": True}

# ---------- Simple UI helper endpoints ----------
@app.post("/ui/metric")
async def ui_metric(request: Request):
    try:
        data = await request.json()
    except Exception:
        data = {}
    name = data.get("name", "ui.event")
    value = float(data.get("value", 1))
    attrs = data.get("attrs", {})
    ui_events.add(value, attributes=attrs | {"name": name})
    logger.info("UI metric", extra={"name": name, "value": value, **attrs})
    return Response(status_code=204)

@app.post("/ui/log")
async def ui_log(request: Request):
    try:
        data = await request.json()
    except Exception:
        data = {}
    level = str(data.get("level", "info")).lower()
    msg = data.get("message", "")
    extra = data.get("extra", {})
    log_fn = getattr(logger, level, logger.info)
    log_fn(f"UI: {msg}", extra=extra)
    return Response(status_code=204)



app.mount('/', StaticFiles(directory=".", html=True), name="src")

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8080)
