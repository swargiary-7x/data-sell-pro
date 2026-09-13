document.addEventListener("DOMContentLoaded", function () {

  const actions = document.querySelectorAll(".action");

  actions.forEach(function (action) {

    action.addEventListener("click", function () {

      const name = action.innerText.trim();

      alert(name + " section coming soon!");

    });

  });

});
