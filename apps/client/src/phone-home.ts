import "@fontsource-variable/saira/wdth.css";
import "./phone-home.css";
import screenShot from "./phone-screen.webp?url";

const page = `
<main class="phone-home" data-testid="phone-home">
  <svg class="ph-logo" viewBox="0 0 122 30" role="img" aria-label="RevRacers"><use href="#brand-logo" /></svg>

  <h1>Race on your computer. <em>Steer with your phone.</em></h1>

  <figure class="ph-scene" aria-hidden="true">
    <div class="ph-laptop">
      <div class="ph-lid"><img src="${screenShot}" alt="" width="800" height="500" /></div>
      <div class="ph-deck"></div>
    </div>
    <svg class="ph-phone" viewBox="0 0 200 96">
      <rect class="ph-body" x="2" y="2" width="196" height="92" rx="18" />
      <rect class="ph-glass" x="10" y="9" width="180" height="78" rx="11" />
      <rect class="ph-brake" x="20" y="18" width="34" height="60" rx="9" />
      <rect class="ph-brake-fill" x="20" y="58" width="34" height="20" rx="9" />
      <rect class="ph-gas" x="146" y="18" width="34" height="60" rx="9" />
      <rect class="ph-gas-fill" x="146" y="30" width="34" height="48" rx="9" />
      <circle class="ph-ring" cx="100" cy="48" r="25" />
      <line class="ph-mark" x1="100" y1="19" x2="100" y2="29" />
    </svg>
  </figure>

  <ol class="ph-steps">
    <li><span>Open <b>revracers.com</b> on a computer</span></li>
    <li><span>Press <kbd>P</kbd></span></li>
    <li><span>Scan the QR code with this phone</span></li>
  </ol>
</main>`;

document.body.insertAdjacentHTML("beforeend", page);
document.body.classList.add("phone-home-on");
document.body.dataset["driveStatus"] = "phone";
document.title = "RevRacers · Play on a computer";
