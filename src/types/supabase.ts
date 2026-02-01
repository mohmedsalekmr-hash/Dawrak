export type Json =
    | string
    | number
    | boolean
    | null
    | { [key: string]: Json | undefined }
    | Json[]

export type Database = {
    public: {
        Tables: {
            queues: {
                Row: {
                    created_at: string
                    current_number: number | null
                    id: number
                    last_issued_number: number | null
                    name: string | null
                }
                Insert: {
                    created_at?: string
                    current_number?: number | null
                    id?: number
                    last_issued_number?: number | null
                    name?: string | null
                }
                Update: {
                    created_at?: string
                    current_number?: number | null
                    id?: number
                    last_issued_number?: number | null
                    name?: string | null
                }
                Relationships: []
            }
        }
        Views: {
            [_ in never]: never
        }
        Functions: {
            next_ticket: {
                Args: {
                    queue_id: number
                }
                Returns: number
            }
        }
        Enums: {
            [_ in never]: never
        }
        CompositeTypes: {
            [_ in never]: never
        }
    }
}
