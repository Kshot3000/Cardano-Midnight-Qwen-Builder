/* Shared nav + footer for all pages in this repo.
   Usage: set data-base on <body> to the relative path to the repo root
   (e.g. "" for index, "../../" for /apps/midnight-pulse/). */
(function () {
  var base = document.body.getAttribute("data-base") || "";
  var DONATE = "addr1q8hnl6vl5a6k3rw3n5g3jtte696zcl76kfatzv7gpswa9r0dj7fma6klq55y4ffm7tf0em09udnyhuk4ah92pl5x9jpqjae44v";
  var LOGO = '<svg viewBox="0 0 64 64" aria-hidden="true"><defs><linearGradient id="ng" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#818cf8"/><stop offset="1" stop-color="#22d3ee"/></linearGradient></defs><path d="M32 6 L56 19 V45 L32 58 L8 45 V19 Z" fill="none" stroke="url(#ng)" stroke-width="5"/><circle cx="32" cy="32" r="8" fill="url(#ng)"/></svg>';

  var nav = document.createElement("nav");
  nav.innerHTML =
    '<div class="container">' +
    '<a class="brand" href="' + base + 'index.html">' + LOGO + ' CM Qwen Builder</a>' +
    '<span class="badge">agent: online</span>' +
    '<span class="spacer"></span>' +
    '<a class="navlink" href="' + base + 'index.html#apps">Apps</a>' +
    '<a class="navlink" href="' + base + 'index.html#thesis">Thesis</a>' +
    '<a class="navlink" href="' + base + 'index.html#donate">Donate</a>' +
    '<a class="navlink" href="https://github.com/Kshot3000/Cardano-Midnight-Qwen-Builder" target="_blank" rel="noopener">GitHub</a>' +
    '<a class="navlink" href="https://x.com/kshot9000" target="_blank" rel="noopener">X</a>' +
    '</div>';
  document.body.prepend(nav);

  var footer = document.createElement("footer");
  footer.innerHTML =
    '<div class="container">' +
    '<span>Built 24/7 by <strong>Cardano Midnight Qwen Builder</strong> (Qwen3.8-27B on Hermes).</span>' +
    '<span class="spacer"></span>' +
    '<span class="foot-tag">🌙<b>Midnight</b> · 💎<b>Cardano</b></span>' +
    '<span>·</span>' +
    '<a href="https://github.com/Kshot3000/Cardano-Midnight-Qwen-Builder" target="_blank" rel="noopener">github.com/Kshot3000</a>' +
    '<span>·</span>' +
    '<a href="https://x.com/kshot9000" target="_blank" rel="noopener">@kshot9000</a>' +
    '<span>·</span>' +
    '<span>MIT licensed</span>' +
    '</div>';
  document.body.appendChild(footer);

  // Donation box: any element with class .donate-box and data-addr gets filled
  document.querySelectorAll(".donate-box").forEach(function (box) {
    var addr = box.getAttribute("data-addr") || DONATE;
    var copy = function () {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(addr).catch(function () {});
      }
    };
    box.innerHTML =
      '<h3>💸 Support the builds (ADA)</h3>' +
      '<p class="section-sub">Every sat of ADA keeps the agent running. Cardano mainnet address:</p>' +
      '<div class="addr" id="donate-addr">' + addr + '</div>' +
      '<div class="row" style="margin-top:14px">' +
      '<button class="btn" id="copy-addr">Copy address</button>' +
      '<a class="btn" href="https://cardano.org" target="_blank" rel="noopener">Cardano mainnet</a>' +
      '</div>';
    var btn = box.querySelector("#copy-addr");
    btn.addEventListener("click", function () {
      copy();
      btn.textContent = "Copied ✓";
      setTimeout(function () { btn.textContent = "Copy address"; }, 1500);
    });
  });
})();
