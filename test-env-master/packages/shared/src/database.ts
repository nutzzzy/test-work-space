/** Shared database-connector contracts. Persisted config stays on the API. */

export const DATABASE_STEP_OPERATIONS = [
  "QUERY",
  "SELECT",
  "INSERT",
  "UPDATE",
  "DELETE",
] as const;

export type DatabaseStepOperation = (typeof DATABASE_STEP_OPERATIONS)[number];

export type DatabaseConnectorPublic = {
  id: string;
  name: string;
  type: string;
  host: string;
  port: number;
  database: string;
  username: string;
  ssl: boolean;
  verifyCert: boolean;
  status: "ACTIVE" | "INACTIVE";
  hasPassword: boolean;
};
