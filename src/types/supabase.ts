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
                    last_called_at: string | null
                }
                Insert: {
                    created_at?: string
                    current_number?: number | null
                    id?: number
                    last_issued_number?: number | null
                    name?: string | null
                    last_called_at?: string | null
                }
                Update: {
                    created_at?: string
                    current_number?: number | null
                    id?: number
                    last_issued_number?: number | null
                    name?: string | null
                    last_called_at?: string | null
                }
                Relationships: []
            }
            tickets: {
                Row: {
                    id: string
                    queue_id: number | null
                    ticket_number: number
                    status: string
                    created_at: string
                    customer_name: string | null
                    customer_phone: string | null
                }
                Insert: {
                    id?: string
                    queue_id?: number | null
                    ticket_number: number
                    status?: string
                    created_at?: string
                    customer_name?: string | null
                    customer_phone?: string | null
                }
                Update: {
                    id?: string
                    queue_id?: number | null
                    ticket_number?: number
                    status?: string
                    created_at?: string
                    customer_name?: string | null
                    customer_phone?: string | null
                }
                Relationships: [
                    {
                        foreignKeyName: "tickets_queue_id_fkey"
                        columns: ["queue_id"]
                        isOneToOne: false
                        referencedRelation: "queues"
                        referencedColumns: ["id"]
                    }
                ]
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
