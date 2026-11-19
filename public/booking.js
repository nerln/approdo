// Mejora opcional: muestra el turno elegido encima del botón. Sin este archivo el formulario funciona igual.
(function () {
  var form = document.getElementById("book-form");
  var box = document.getElementById("summary");
  var out = document.getElementById("summary-text");
  if (!form || !box || !out) return;
  function update() {
    var r = form.querySelector("input[name=slot]:checked");
    if (!r) return;
    out.textContent = r.getAttribute("data-label") || r.value;
    box.hidden = false;
  }
  form.addEventListener("change", update);
  update();
})();
