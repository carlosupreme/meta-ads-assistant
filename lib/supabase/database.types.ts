export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export interface Database {
  public: {
    Tables: {
      pulso_workspaces: {
        Row: {
          id: string;
          owner_id: string | null;
          name: string;
          payload: Json;
          version: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          owner_id?: string | null;
          name?: string;
          payload?: Json;
          version?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          owner_id?: string | null;
          name?: string;
          payload?: Json;
          version?: number;
          updated_at?: string;
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
