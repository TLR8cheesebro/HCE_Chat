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

app.post("/chat", (req, res) => {
  console.log("Received /chat request with body:", req.body);

  const { message, language = "en", programsSelected = [] } = req.body;

  res.json({
    reply: `Echo: "${message}". Language: ${language}. Programs: ${
      programsSelected.join(", ") || "none"
    }.`
  });
});


    const response = await client.responses.create({
      model: "gpt-4.1-mini", // or another model available to your account
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

    // Safely extract the reply text
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

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

