const express = require("express");
const cors = require("cors");
require("dotenv").config();
const OpenAI = require("openai");

const app = express();
const PORT = process.env.PORT || 3000;

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

app.use(cors());
app.use(express.json());
app.use(express.static("public"));

// Health check
app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

// AI Chat Route
app.post("/chat", async (req, res) => {
  console.log("Received /chat request with body:", req.body);

  try {
    const { message, language = "en", programsSelected = [] } = req.body;

    if (!message) {
      return res.status(400).json({ error: "Missing 'message' in request body" });
    }

    const systemPrompt = `
You are an enrollment assistant for a healthcare training school.
You respond in the user's preferred language: ${language}.
Programs of interest: ${programsSelected.join(", ") || "none"}.
Answer briefly, clearly, and always encourage them to enroll.
If you don't know something, say a staff member will follow up.
`;

    const response = await client.responses.create({
      model: "gpt-4.1-mini", // or any model you choose
      input: [
        {
          role: "system",
          content: systemPrompt,
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: message,
            },
          ],
        },
      ],
    });

    console.log("OpenAI raw response:", JSON.stringify(response, null, 2));

    let replyText = "";

    if (response.output_text) {
      replyText = response.output_text;
    } else if (
      response.output &&
      response.output[0] &&
      response.output[0].content &&
      response.output[0].content[0] &&
      response.output[0].content[0].text
    ) {
      replyText = response.output[0].content[0].text;
    } else {
      replyText = "Sorry, I couldn't generate a response.";
    }

    res.json({ reply: replyText });
  } catch (err) {
    console.error("Error in /chat:", err);
    res.status(500).json({ error: "AI error", details: err.message });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
