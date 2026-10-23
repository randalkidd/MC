try { if (localStorage.getItem("mc.theme") === "light") document.documentElement.dataset.theme = "light"; } catch (e) {}

try { var a = localStorage.getItem("mc.accent"); if (a && a !== "teal" && /^[a-z]{3,10}$/.test(a)) document.documentElement.dataset.accent = a; } catch (e) {}
