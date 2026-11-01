export class ApiError extends Error {
  constructor(public code: string, message: string) { super(message); }
}

export async function post<T>(path: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  } catch {
    throw new ApiError("network", "تعذر الاتصال. تحقق من الشبكة ثم أعد المحاولة.");
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(data?.error?.code ?? "internal", data?.error?.message ?? "حدث خطأ غير متوقع. أعد المحاولة.");
  return data as T;
}

export const todayIso = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};

export const formatDate = (iso: string | null) =>
  !iso ? "—" : new Intl.DateTimeFormat("ar-SA-u-ca-gregory-nu-latn", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));
