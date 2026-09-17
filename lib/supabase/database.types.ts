export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export interface Database {
  public: {
    Tables: {
      pulso_workspaces: {
        Row: {
          id: string;
          owner_id: string;
          name: string;
          payload: Json;
          version: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          owner_id: string;
          name?: string;
          payload?: Json;
          version?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          owner_id?: string;
          name?: string;
          payload?: Json;
          version?: number;
          updated_at?: string;
        };
        Relationships: [];
      };
      pulso_report_links: {
        Row: {
          token: string;
          workspace_id: string;
          organization_id: string;
          created_at: string;
          revoked_at: string | null;
        };
        Insert: {
          token: string;
          workspace_id: string;
          organization_id: string;
          created_at?: string;
          revoked_at?: string | null;
        };
        Update: {
          revoked_at?: string | null;
        };
        Relationships: [];
      };
      pulso_ai_logs: {
        Row: {
          id: string;
          created_at: string;
          workspace_id: string | null;
          owner_email: string | null;
          organization_id: string | null;
          organization_name: string | null;
          feature: string;
          route: string | null;
          view: string | null;
          trigger: "user" | "cron";
          model: string;
          status: "ok" | "error";
          duration_ms: number;
          input_tokens: number;
          cached_input_tokens: number;
          output_tokens: number;
          reasoning_tokens: number;
          total_tokens: number;
          cost_usd: number;
          openai_response_id: string | null;
          error: string | null;
          entry: Json;
        };
        Insert: {
          id?: string;
          created_at?: string;
          workspace_id?: string | null;
          owner_email?: string | null;
          organization_id?: string | null;
          organization_name?: string | null;
          feature: string;
          route?: string | null;
          view?: string | null;
          trigger?: "user" | "cron";
          model: string;
          status: "ok" | "error";
          duration_ms?: number;
          input_tokens?: number;
          cached_input_tokens?: number;
          output_tokens?: number;
          reasoning_tokens?: number;
          total_tokens?: number;
          cost_usd?: number;
          openai_response_id?: string | null;
          error?: string | null;
          entry?: Json;
        };
        Update: Record<string, never>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
