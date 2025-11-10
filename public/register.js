document.getElementById('registerForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(e.target));
  const messageEl = document.getElementById('registerMessage');
  messageEl.textContent = ""; // Clear old message

  try {
    const res = await window.api.register(data);
    if (res?.success) {
      messageEl.style.color = "green";
      messageEl.textContent = "Registration successful! Redirecting...";
      setTimeout(() => {
        window.api.navigateTo('login.html');
      }, 1500); // Delay so user can read message
    } else {
      messageEl.style.color = "red";
      messageEl.textContent = res.error || "Registration failed";
    }
  } catch (err) {
    messageEl.style.color = "red";
    messageEl.textContent = "Error: " + err.message;
  }
});

document.getElementById('goToLogin').addEventListener('click', (e) => {
  e.preventDefault();
  window.api.navigateTo('login.html');
});
