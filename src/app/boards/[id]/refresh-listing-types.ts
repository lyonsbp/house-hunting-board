export type RefreshResult =
  | {
      ok: true;
      listPriceChanged: boolean;
      soldPriceChanged: boolean;
      statusChanged: boolean;
      previousStatus: string | null;
      newStatus: string | null;
    }
  | { error: string };
