export { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";

/** Navigate to the local self-hosted sign-in screen from an event handler. */
export const startLogin = () => {
  window.location.href = "/auth";
};
