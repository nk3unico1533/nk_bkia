export async function applyHMR(body) {
  return {
    hmr: true,
    updated: body,
    message: "HMR aplicado com sucesso ✔️"
  };
}