import { loadScript } from 'https://cdn.jsdelivr.net/npm/@paypal/paypal-js@8.1.2/+esm';

class Year extends HTMLElement {
    connectedCallback() {
        this.innerHTML = new Date().getFullYear();
    }
}

customElements.define("x-date", Year);

class PayPal extends HTMLElement {
    static observedAttributes = ["amount"];

    constructor() {
        // Always call super first in constructor
        super();
    }
    async connectedCallback() {
        const res = await fetch(import.meta.url.replace("index.js", "clientid"));
        const oClient = await res.json();
        const nAmount = this.getAttribute("amount");
        const sCurrency = this.getAttribute("currency");
        this.innerHTML = `
        <div id="paypal-button-container"></div>

        <p id="result-message"></p>
         `
        let paypal;
        try {
            paypal = await loadScript({ clientId: oClient.clientid, currency: sCurrency });
            paypal.resultMessage = (sMessage) => document.querySelector("#result-message").innerHTML = sMessage;
        } catch (error) {
            console.error("failed to load the PayPal JS SDK script", error);
        }

        if (paypal) {
            try {
                await paypal.Buttons({
                    style: {

                        shape: "rect",

                        layout: "vertical",

                        color: "gold",

                        label: "paypal",

                    },

                    message: {

                        amount: nAmount,

                    },

                    async createOrder() {

                        try {

                            const response = await fetch(import.meta.url.replace("index.js", "orders"), {

                                method: "POST",

                                headers: {

                                    "Content-Type": "application/json",

                                },

                                // use the "body" param to optionally pass additional order information

                                // like product ids and quantities

                                body: JSON.stringify({

                                    cart: [

                                        {

                                            id: "YOUR_PRODUCT_ID",

                                            quantity: "YOUR_PRODUCT_QUANTITY",

                                            amount: nAmount,

                                            currency: sCurrency,

                                        },

                                    ],

                                }),

                            });


                            const orderData = await response.json();


                            if (orderData.id) {

                                return orderData.id;

                            }

                            const errorDetail = orderData?.details?.[0];

                            const errorMessage = errorDetail

                                ? `${errorDetail.issue} ${errorDetail.description} (${orderData.debug_id})`

                                : JSON.stringify(orderData);


                            throw new Error(errorMessage);

                        } catch (error) {

                            console.error(error);

                            paypal.resultMessage(`Could not initiate PayPal Checkout...<br><br>${error}`);

                        }

                    },


                    async onApprove(data, actions) {

                        try {

                            const response = await fetch(

                                import.meta.url.replace("index.js", `capture/${data.orderID}`),

                                {

                                    method: "POST",

                                    headers: {

                                        "Content-Type": "application/json",

                                    },

                                }

                            );


                            const orderData = await response.json();

                            // Three cases to handle:

                            //   (1) Recoverable INSTRUMENT_DECLINED -> call actions.restart()

                            //   (2) Other non-recoverable errors -> Show a failure message

                            //   (3) Successful transaction -> Show confirmation or thank you message


                            const errorDetail = orderData?.details?.[0];


                            if (errorDetail?.issue === "INSTRUMENT_DECLINED") {

                                // (1) Recoverable INSTRUMENT_DECLINED -> call actions.restart()

                                // recoverable state, per

                                // https://developer.paypal.com/docs/checkout/standard/customize/handle-funding-failures/

                                return actions.restart();

                            } else if (errorDetail) {

                                // (2) Other non-recoverable errors -> Show a failure message

                                throw new Error(

                                    `${errorDetail.description} (${orderData.debug_id})`

                                );

                            } else if (!orderData.purchase_units) {

                                throw new Error(JSON.stringify(orderData));

                            } else {

                                // (3) Successful transaction -> Show confirmation or thank you message

                                // Or go to another URL:  actions.redirect('thank_you.html');

                                const transaction =

                                    orderData?.purchase_units?.[0]?.payments

                                        ?.captures?.[0] ||

                                    orderData?.purchase_units?.[0]?.payments

                                        ?.authorizations?.[0];

                                paypal.resultMessage(

                                    `Transaction ${transaction.status}: ${transaction.id}<br>
            
                      <br>See console for all available details`

                                );

                                console.log(

                                    "Capture result",

                                    orderData,

                                    JSON.stringify(orderData, null, 2)

                                );

                            }

                        } catch (error) {

                            console.error(error);

                            paypal.resultMessage(

                                `Sorry, your transaction could not be processed...<br><br>${error}`

                            );

                        }

                    },

                }
                ).render("#paypal-button-container");
            } catch (error) {
                console.error("failed to render the PayPal Buttons", error);
            }
        }
    }
}

customElements.define("x-paypal", PayPal)