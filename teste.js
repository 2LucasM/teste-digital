"use strict";

// Teste descartável: passkey com digital + chave PRF para cifrar um texto no aparelho.
// Nada sai do aparelho: não há servidor, só arquivos estáticos.

const CHAVE_CRED = "td_cred";
const CHAVE_SAL = "td_sal";
const CHAVE_CIFRA = "td_cifra";

const registro = [];
const $ = (id) => document.getElementById(id);

function anotar(linha) {
  registro.push(linha);
  $("relatorio").textContent = registro.join("\n");
}

function mostrar(id, texto, ok) {
  const el = $(id);
  el.textContent = texto;
  el.className = "estado " + (ok ? "ok" : "erro");
}

function paraB64(buffer) {
  const bytes = new Uint8Array(buffer);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function deB64(texto) {
  const s = atob(texto.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return bytes;
}

function aleatorio(n) {
  return crypto.getRandomValues(new Uint8Array(n));
}

function ler(chave) {
  try { return localStorage.getItem(chave); } catch { return null; }
}

function gravar(chave, valor) {
  try { localStorage.setItem(chave, valor); return true; } catch { return false; }
}

function descreverErro(e) {
  return (e && e.name ? e.name + ": " : "") + (e && e.message ? e.message : String(e));
}

function modoInstalado() {
  return window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
}

function atualizarRede() {
  $("rede").textContent = navigator.onLine ? "com internet" : "sem internet";
}

function atualizarBotoes() {
  const temCred = !!ler(CHAVE_CRED);
  $("trancar").disabled = !temCred;
  $("abrir").disabled = !(temCred && ler(CHAVE_CIFRA));
}

async function checar() {
  const itens = [];
  const add = (rotulo, valor) => itens.push([rotulo, valor]);

  add("Endereço seguro (HTTPS)", window.isSecureContext ? "sim" : "não");
  add("Aberto como app instalado", modoInstalado() ? "sim" : "não");
  add("Passkey no navegador", window.PublicKeyCredential ? "sim" : "não");

  if (window.PublicKeyCredential) {
    try {
      const plataforma = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
      add("Digital/rosto/senha do aparelho", plataforma ? "sim" : "não");
    } catch (e) {
      add("Digital/rosto/senha do aparelho", "erro (" + descreverErro(e) + ")");
    }
    if (typeof PublicKeyCredential.getClientCapabilities === "function") {
      try {
        const caps = await PublicKeyCredential.getClientCapabilities();
        const prf = caps["extension:prf"];
        add("Chave de cifra (PRF) anunciada", prf === undefined ? "não informado" : (prf ? "sim" : "não"));
      } catch (e) {
        add("Chave de cifra (PRF) anunciada", "erro (" + descreverErro(e) + ")");
      }
    } else {
      add("Chave de cifra (PRF) anunciada", "não informado");
    }
  }
  add("Cifra do navegador", window.crypto && crypto.subtle ? "sim" : "não");
  add("Guarda local", ler("__x") === null && gravar("__x", "1") ? "sim" : "não");
  try { localStorage.removeItem("__x"); } catch { /* sem guarda local */ }

  $("checagens").innerHTML = "";
  for (const [rotulo, valor] of itens) {
    const li = document.createElement("li");
    li.textContent = rotulo + ": " + valor;
    $("checagens").appendChild(li);
    anotar(rotulo + ": " + valor);
  }
}

// Bit 2 das flags do authenticatorData = o aparelho conferiu digital/rosto/senha.
function usuarioConferido(authData) {
  const flags = new Uint8Array(authData)[32];
  return (flags & 0x04) !== 0;
}

async function criar() {
  $("criar").disabled = true;
  try {
    const sal = aleatorio(32);
    const cred = await navigator.credentials.create({
      publicKey: {
        rp: { name: "Teste digital" },
        user: { id: aleatorio(16), name: "teste", displayName: "Teste digital" },
        challenge: aleatorio(32),
        pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
        authenticatorSelection: {
          authenticatorAttachment: "platform",
          residentKey: "preferred",
          userVerification: "required",
        },
        timeout: 120000,
        extensions: { prf: {} },
      },
    });
    const prf = cred.getClientExtensionResults().prf;
    gravar(CHAVE_CRED, paraB64(cred.rawId));
    gravar(CHAVE_SAL, paraB64(sal));
    try { localStorage.removeItem(CHAVE_CIFRA); } catch { /* sem guarda local */ }
    const habilitado = prf && prf.enabled === true;
    anotar("Criar chave: ok; PRF habilitado = " + (prf ? String(prf.enabled) : "sem resposta"));
    mostrar("estado-criar",
      habilitado ? "Chave criada, com cifra disponível." :
        "Chave criada, mas o aparelho não confirmou a cifra. Tente o passo 3 mesmo assim.",
      habilitado);
  } catch (e) {
    anotar("Criar chave: falhou; " + descreverErro(e));
    mostrar("estado-criar", "Não deu: " + descreverErro(e), false);
  } finally {
    $("criar").disabled = false;
    atualizarBotoes();
  }
}

async function chaveDaDigital() {
  const credId = ler(CHAVE_CRED);
  const sal = ler(CHAVE_SAL);
  if (!credId || !sal) throw new Error("Crie a chave no passo 2 primeiro.");
  const resposta = await navigator.credentials.get({
    publicKey: {
      challenge: aleatorio(32),
      allowCredentials: [{ type: "public-key", id: deB64(credId) }],
      userVerification: "required",
      timeout: 120000,
      extensions: { prf: { eval: { first: deB64(sal) } } },
    },
  });
  const conferido = usuarioConferido(resposta.response.authenticatorData);
  const resultado = resposta.getClientExtensionResults().prf;
  const segredo = resultado && resultado.results && resultado.results.first;
  if (!segredo) {
    throw new Error("O aparelho conferiu a digital, mas não entregou a chave de cifra (PRF).");
  }
  const chave = await crypto.subtle.importKey("raw", segredo, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
  return { chave, conferido };
}

async function trancar() {
  $("trancar").disabled = true;
  try {
    const { chave, conferido } = await chaveDaDigital();
    const iv = aleatorio(12);
    const dados = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, chave, new TextEncoder().encode($("texto").value));
    gravar(CHAVE_CIFRA, JSON.stringify({ iv: paraB64(iv), dados: paraB64(dados) }));
    $("texto").value = "";
    anotar("Trancar: ok; digital conferida = " + (conferido ? "sim" : "não") + "; " + (navigator.onLine ? "com" : "sem") + " internet");
    mostrar("estado-trancar", "Texto trancado e apagado da tela. Agora teste o passo 4.", true);
  } catch (e) {
    anotar("Trancar: falhou; " + descreverErro(e));
    mostrar("estado-trancar", "Não deu: " + descreverErro(e), false);
  } finally {
    atualizarBotoes();
  }
}

async function abrir() {
  $("abrir").disabled = true;
  try {
    const guardado = JSON.parse(ler(CHAVE_CIFRA));
    const { chave, conferido } = await chaveDaDigital();
    const claro = await crypto.subtle.decrypt({ name: "AES-GCM", iv: deB64(guardado.iv) }, chave, deB64(guardado.dados));
    $("texto").value = new TextDecoder().decode(claro);
    anotar("Abrir: ok; digital conferida = " + (conferido ? "sim" : "não") + "; " + (navigator.onLine ? "com" : "sem") + " internet; " + (modoInstalado() ? "app instalado" : "navegador"));
    mostrar("estado-abrir", "Abriu. O texto voltou para o campo do passo 3.", true);
  } catch (e) {
    anotar("Abrir: falhou; " + descreverErro(e));
    mostrar("estado-abrir", "Não deu: " + descreverErro(e), false);
  } finally {
    atualizarBotoes();
  }
}

async function copiar() {
  const texto = registro.join("\n") + "\n" + navigator.userAgent;
  try {
    await navigator.clipboard.writeText(texto);
    mostrar("estado-copiar", "Copiado. Cole na conversa.", true);
  } catch {
    mostrar("estado-copiar", "Não copiou sozinho: selecione o texto abaixo e copie.", false);
  }
}

function limpar() {
  for (const chave of [CHAVE_CRED, CHAVE_SAL, CHAVE_CIFRA]) {
    try { localStorage.removeItem(chave); } catch { /* sem guarda local */ }
  }
  atualizarBotoes();
  mostrar("estado-copiar",
    "Apagado daqui. A chave \"Teste digital\" ainda fica nas senhas do aparelho; apague por lá se quiser.", true);
}

$("criar").addEventListener("click", criar);
$("trancar").addEventListener("click", trancar);
$("abrir").addEventListener("click", abrir);
$("copiar").addEventListener("click", copiar);
$("limpar").addEventListener("click", limpar);
window.addEventListener("online", atualizarRede);
window.addEventListener("offline", atualizarRede);

atualizarRede();
atualizarBotoes();
checar();

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").then(
    () => anotar("Funcionar sem internet: preparado"),
    (e) => anotar("Funcionar sem internet: falhou; " + descreverErro(e)),
  );
} else {
  anotar("Funcionar sem internet: não suportado");
}
