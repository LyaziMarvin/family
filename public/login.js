document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(e.target));
  const messageEl = document.getElementById('loginMessage');
  messageEl.textContent = ""; // Clear old message

  try {
    const res = await window.api.login(data);
    if (res?.token) {
      localStorage.setItem('token', res.token);
      window.api.navigateTo('index.html'); // Or your main page
    } else {
      messageEl.style.color = "red";
      messageEl.textContent = res.error || "Login failed";
    }
  } catch (err) {
    messageEl.style.color = "red";
    messageEl.textContent = "Error: " + err.message;
  }
});

document.getElementById('goToRegister').addEventListener('click', (e) => {
  e.preventDefault();
  window.api.navigateTo('register.html');
});
