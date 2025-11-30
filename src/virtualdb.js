let database = {};

export function vdb({ action, table, data }) {
  if (!database[table]) database[table] = [];

  switch (action) {
    case "insert":
      database[table].push(data);
      return { ok: true };

    case "select":
      return database[table];

    case "reset":
      database = {};
      return { reset: true };

    default:
      return { error: "Ação inválida" };
  }
}