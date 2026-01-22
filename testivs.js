const axios = require("axios");

const testWebhook = async () => {
  const payload = {
    version: "0",
    id: "5d7056bd-90b9-760c-781f-6aaa84472eb0",
    "detail-type": "IVS Stream State Change",
    source: "aws.ivs",
    account: "693148193622",
    time: "2025-12-15T21:59:35Z",
    region: "us-east-1",
    resources: ["arn:aws:ivs:us-east-1:693148193622:channel/0pJWDfgTQqqI"],
    detail: {
      event_name: "Stream Start",
      channel_name: "Floreciendo-juntas-channel",
      stream_id: "st-1FC89wK9KBB1vQ8N9XR1qjz",
    },
  };

  try {
    console.log("🧪 Enviando webhook de prueba...");
    const response = await axios.post(
      "https://api.floreciendojuntas.com/api/lives/webhooks/ivs",
      payload,
    );
    console.log("✅ Respuesta:", response.data);
  } catch (error) {
    console.error("❌ Error:", error.response?.data || error.message);
  }
};

testWebhook();
