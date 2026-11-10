const phoneAgent = /iPhone|iPod|Android.+Mobile/i;
const phoneSide = 600;

interface HintedNavigator extends Navigator {
  userAgentData?: { mobile?: boolean };
}

let phone: boolean | null = null;

function touchOnly(): boolean {
  return (
    matchMedia("(hover: none) and (pointer: coarse)").matches &&
    !matchMedia("(any-pointer: fine)").matches
  );
}

export function onPhone(): boolean {
  const agent = navigator as HintedNavigator;
  phone ??=
    agent.userAgentData?.mobile === true ||
    phoneAgent.test(agent.userAgent) ||
    (touchOnly() && Math.min(screen.width, screen.height) < phoneSide);
  return phone;
}
