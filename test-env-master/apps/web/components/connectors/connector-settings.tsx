"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useI18n } from "@/lib/i18n";

type Connector = {
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

const TYPES = [
  "MYSQL",
  "POSTGRESQL",
  "ORACLE",
  "SQLSERVER",
  "MONGODB",
  "REDIS",
  "ELASTICSEARCH",
] as const;

const EMPTY = {
  name: "",
  type: "POSTGRESQL",
  host: "127.0.0.1",
  port: "5432",
  database: "",
  username: "",
  password: "",
  ssl: false,
  verifyCert: true,
  status: "ACTIVE" as "ACTIVE" | "INACTIVE",
};

export function ConnectorSettings() {
  const { t, err } = useI18n();
  const [rows, setRows] = useState<Connector[]>([]);
  const [form, setForm] = useState(EMPTY);
  const [editing, setEditing] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = async () => {
    setRows(await api<Connector[]>("/database-connectors"));
  };

  useEffect(() => {
    load().catch((error) =>
      setMessage(error instanceof Error ? err(error.message) : t("errors.loadFailed")),
    );
  }, [err, t]);

  const submit = async () => {
    const body = {
      ...form,
      port: Number(form.port),
    };
    try {
      if (editing) {
        await api(`/database-connectors/${editing}`, {
          method: "PATCH",
          body: JSON.stringify(body),
        });
      } else {
        await api("/database-connectors", {
          method: "POST",
          body: JSON.stringify(body),
        });
      }
      setForm(EMPTY);
      setEditing(null);
      setMessage(t("settings.saved"));
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? err(error.message) : t("errors.failed"));
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("connectors.title")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">{t("connectors.hint")}</p>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("connectors.empty")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="px-2 py-1 text-start font-medium">{t("connectors.name")}</th>
                  <th className="px-2 py-1 text-start font-medium">{t("connectors.type")}</th>
                  <th className="px-2 py-1 text-start font-medium">{t("connectors.host")}</th>
                  <th className="px-2 py-1 text-start font-medium">{t("connectors.status")}</th>
                  <th className="px-2 py-1 text-start font-medium" />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-b border-border">
                    <td className="px-2 py-1">{row.name}</td>
                    <td className="px-2 py-1 font-mono">{row.type}</td>
                    <td className="px-2 py-1 font-mono dir-ltr">{row.host}:{row.port}</td>
                    <td className="px-2 py-1">
                      {row.status === "ACTIVE" ? t("connectors.active") : t("connectors.inactive")}
                    </td>
                    <td className="px-2 py-1">
                      <div className="flex flex-wrap gap-1">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={async () => {
                            try {
                              await api(`/database-connectors/${row.id}/test`, { method: "POST", body: "{}" });
                              setMessage(t("connectors.testOk"));
                            } catch (error) {
                              setMessage(error instanceof Error ? err(error.message) : t("errors.failed"));
                            }
                          }}
                        >
                          {t("connectors.test")}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setEditing(row.id);
                            setForm({
                              name: row.name,
                              type: row.type,
                              host: row.host,
                              port: String(row.port),
                              database: row.database,
                              username: row.username,
                              password: "",
                              ssl: row.ssl,
                              verifyCert: row.verifyCert,
                              status: row.status,
                            });
                          }}
                        >
                          {t("common.edit")}
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={async () => {
                            await api(`/database-connectors/${row.id}`, { method: "DELETE" });
                            await load();
                          }}
                        >
                          {t("common.delete")}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Field label={t("connectors.name")} value={form.name} onChange={(name) => setForm({ ...form, name })} />
          <label className="block space-y-1 text-xs">
            <span className="text-muted-foreground">{t("connectors.type")}</span>
            <select
              className="h-8 w-full rounded-md border border-border bg-background px-2 text-sm"
              value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value })}
            >
              {TYPES.map((type) => (
                <option key={type} value={type}>
                  {t(`connectors.types.${type}`)}
                </option>
              ))}
            </select>
          </label>
          <Field label={t("connectors.host")} value={form.host} dir="ltr" onChange={(host) => setForm({ ...form, host })} />
          <Field label={t("connectors.port")} value={form.port} dir="ltr" onChange={(port) => setForm({ ...form, port })} />
          <Field label={t("connectors.database")} value={form.database} dir="ltr" onChange={(database) => setForm({ ...form, database })} />
          <Field label={t("connectors.username")} value={form.username} dir="ltr" onChange={(username) => setForm({ ...form, username })} />
          <Field
            label={t("connectors.password")}
            value={form.password}
            dir="ltr"
            placeholder={editing ? t("connectors.passwordKeep") : undefined}
            onChange={(password) => setForm({ ...form, password })}
            type="password"
          />
          <label className="block space-y-1 text-xs">
            <span className="text-muted-foreground">{t("connectors.status")}</span>
            <select
              className="h-8 w-full rounded-md border border-border bg-background px-2 text-sm"
              value={form.status}
              onChange={(e) =>
                setForm({ ...form, status: e.target.value === "INACTIVE" ? "INACTIVE" : "ACTIVE" })
              }
            >
              <option value="ACTIVE">{t("connectors.active")}</option>
              <option value="INACTIVE">{t("connectors.inactive")}</option>
            </select>
          </label>
        </div>
        <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={form.ssl} onChange={(e) => setForm({ ...form, ssl: e.target.checked })} />
            {t("connectors.ssl")}
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={form.verifyCert}
              onChange={(e) => setForm({ ...form, verifyCert: e.target.checked })}
            />
            {t("connectors.verifyCert")}
          </label>
        </div>
        <Button onClick={submit}>{editing ? t("common.save") : t("connectors.save")}</Button>
        {message ? <p className="text-xs text-muted-foreground">{message}</p> : null}
      </CardContent>
    </Card>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  dir,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  dir?: "ltr" | "rtl";
  type?: string;
}) {
  return (
    <label className="block space-y-1 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <input
        className="h-8 w-full rounded-md border border-border bg-background px-2 text-sm"
        value={value}
        placeholder={placeholder}
        dir={dir}
        type={type}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}
