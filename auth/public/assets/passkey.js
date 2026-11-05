const b64u = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64u = (value) => Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/")), (char) => char.charCodeAt(0));

function prepare(options) {
  options.challenge = fromB64u(options.challenge);
  if (options.user) options.user.id = fromB64u(options.user.id);
  for (const item of options.allowCredentials || []) item.id = fromB64u(item.id);
  return options;
}

async function publicKeyOf(credential) {
  const key = credential.response.getPublicKey?.();
  if (!key) return null;
  return b64u(key);
}

if (window.PublicKeyCredential) {
  const login = document.getElementById("passkeyLogin");
  if (login) login.hidden = false;
  async function signIn(mediation) {
    const options = prepare(await (await fetch(`/interaction/${login.dataset.uid}/passkey/options`)).json());
    const credential = await navigator.credentials.get({ publicKey: options, mediation });
    if (!credential) return;
    const response = await fetch(`/interaction/${login.dataset.uid}/passkey`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: credential.id,
        authenticatorData: b64u(credential.response.authenticatorData),
        clientDataJSON: b64u(credential.response.clientDataJSON),
        signature: b64u(credential.response.signature)
      })
    });
    if (response.redirected) window.location.assign(response.url);
    else window.location.reload();
  }
  login?.addEventListener("click", () => signIn("required").catch(() => {}));
  if (login && !new URLSearchParams(location.search).has("social")) signIn("conditional").catch(() => {});

  const add = document.getElementById("passkeyAdd");
  if (add) add.hidden = false;
  add?.addEventListener("click", async () => {
    const options = prepare(await (await fetch("/account/passkey/options", { method: "POST", headers: { "x-csrf-token": add.dataset.csrf } })).json());
    const credential = await navigator.credentials.create({ publicKey: options });
    const response = await fetch("/account/passkey", {
      method: "POST",
      headers: { "content-type": "application/json", "x-csrf-token": add.dataset.csrf },
      body: JSON.stringify({
        id: credential.id,
        publicKey: await publicKeyOf(credential),
        authenticatorData: b64u(credential.response.authenticatorData),
        clientDataJSON: b64u(credential.response.clientDataJSON)
      })
    });
    if (response.ok) window.location.assign("/account/security?done=passkey");
  });
}
