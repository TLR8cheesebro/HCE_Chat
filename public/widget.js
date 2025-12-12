const backendURL = "https://hce-chat-p4ot.onrender.com/chat";

const messagesContainer = document.getElementById("chat-messages");
const input = document.getElementById("chat-input");
const sendButton = document.getElementById("chat-send");

function addMessage(text, sender = "bot") {
  const msg = document.createElement("div");
  msg.classList.add("message");
  msg.classList.add(sender === "user" ? "user-message" : "bot-message");
  msg.textContent = text;

  messagesContainer.appendChild(msg);
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

async function sendMessage() {
  const text = input.value.trim();
  if (!text) return;

  // User message
  addMessage(text, "user");
  input.value = "";

  // Loading indicator
  const loadingMsg = document.createElement("div");
  loadingMsg.classList.add("message", "bot-message", "loading");
  loadingMsg.textContent = "Typing...";
  messagesContainer.appendChild(loadingMsg);
  messagesContainer.scrollTop = messagesContainer.scrollHeight;

  try {
    const response = await fetch(backendURL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ message: text })
    });

    const data = await response.json();

    loadingMsg.remove();
    addMessage(data.reply || "[Error: No response]", "bot");

  } catch (err) {
    loadingMsg.remove();
    addMessage("Sorry, something went wrong.", "bot");
  }
}

sendButton.addEventListener("click", sendMessage);
input.addEventListener("keypress", (e) => {
  if (e.key === "Enter") sendMessage();
});
