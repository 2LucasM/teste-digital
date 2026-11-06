"use strict";

// Guarda os arquivos da página para ela abrir sem internet.
const VERSAO = "teste-digital-v3";
const ARQUIVOS = ["./", "index.html", "teste.js", "manifest.webmanifest", "icone.svg"];

// cache "reload"/"no-cache": sem isso o navegador entrega a cópia da memória dele (vale 10 minutos no
// GitHub Pages) e a versão nova da página fica guardada com o script velho.
self.addEventListener("install", (evento) => {
  evento.waitUntil(caches.open(VERSAO).then((cache) =>
    cache.addAll(ARQUIVOS.map((url) => new Request(url, { cache: "reload" })))));
  self.skipWaiting();
});

self.addEventListener("activate", (evento) => {
  evento.waitUntil(
    caches.keys().then((nomes) => Promise.all(nomes.filter((n) => n !== VERSAO).map((n) => caches.delete(n)))),
  );
  self.clients.claim();
});

// Rede primeiro; sem rede, a cópia guardada.
self.addEventListener("fetch", (evento) => {
  if (evento.request.method !== "GET") return;
  evento.respondWith(
    fetch(evento.request, { cache: "no-cache" })
      .then((resposta) => {
        if (resposta.ok) {
          const copia = resposta.clone();
          caches.open(VERSAO).then((cache) => cache.put(evento.request, copia));
        }
        return resposta;
      })
      .catch(() => caches.match(evento.request, { ignoreSearch: true })),
  );
});
