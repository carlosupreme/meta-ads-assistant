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
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
