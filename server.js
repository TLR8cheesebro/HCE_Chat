// server.js
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

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

app.post("/chat", async (req, res) => {
  try {
    const { message, language = "en", programsSelected = [] } = req.body;

    const systemPrompt = `
You are an enrollment assistant for a healthcare training school.
You speak to users in their preferred language: ${language}.
Programs of interest: ${programsSelected.join(", ") || "none"}.
Answer briefly, clearly, and always encourage them to enroll.
If you don't know something (like specific schedule dates), say you'll have a staff member follow up.
`;

    const response = await client.responses.create({
      model: "gpt-5", // or gpt-4.1-mini, depending on your account
      input: [
        {
          role: "system",
          content: systemPrompt,
        },
        {
          role: "user",
          content: [
            { type: "input_text", text: message },
          ],
        },
      ],
    });

    const replyText = response.output_text; // SDK convenience field

    res.json({ reply: replyText });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "AI error" });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
