import uvicorn
from fastapi import FastAPI, Request
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
import os
import logging

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



load_dotenv()
app = FastAPI()

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


@app.get("/clientid")
async def clientid():
   return {
      "clientid": os.environ['PAYPAL_CLIENT_ID']      
      }

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

    request_body = await request.json()

    # use the cart information passed from the front-end to calculate the order amount detals

    cart = request_body["cart"]

    order = orders_controller.orders_create(

        {

            "body": OrderRequest(

                intent=CheckoutPaymentIntent.CAPTURE,

                purchase_units=[

                    PurchaseUnitRequest(

                        amount=AmountWithBreakdown(

                            currency_code=cart[0]['currency'],

                            value=cart[0]['amount'],

                        ),


                    )

                ],


            )

        }

    )

    return order.body

@app.post("/capture/{order_id}")
def  capture_order(order_id: str):
    order = orders_controller.orders_capture(

        {"id": order_id, "prefer": "return=representation"}

    )

    return order.body



app.mount('/', StaticFiles(directory=".", html=True), name="src")

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8080)
