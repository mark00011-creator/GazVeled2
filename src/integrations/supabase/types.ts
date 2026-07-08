export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      audit_log: {
        Row: {
          action: string
          created_at: string
          entity_id: string | null
          entity_type: string
          id: string
          new_value: Json | null
          old_value: Json | null
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          entity_id?: string | null
          entity_type: string
          id?: string
          new_value?: Json | null
          old_value?: Json | null
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          id?: string
          new_value?: Json | null
          old_value?: Json | null
          user_id?: string | null
        }
        Relationships: []
      }
      bulk_scans: {
        Row: {
          barcodes: string[]
          created_at: string
          created_by: string | null
          id: string
          image_url: string | null
          status: string
        }
        Insert: {
          barcodes?: string[]
          created_at?: string
          created_by?: string | null
          id?: string
          image_url?: string | null
          status?: string
        }
        Update: {
          barcodes?: string[]
          created_at?: string
          created_by?: string | null
          id?: string
          image_url?: string | null
          status?: string
        }
        Relationships: []
      }
      chinese_cylinder_stock: {
        Row: {
          created_at: string
          empty_count: number
          full_count: number
          gas_type: string
          id: string
          size: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          empty_count?: number
          full_count?: number
          gas_type: string
          id?: string
          size: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          empty_count?: number
          full_count?: number
          gas_type?: string
          id?: string
          size?: string
          updated_at?: string
        }
        Relationships: []
      }
      chinese_stock_movements: {
        Row: {
          created_at: string
          created_by: string | null
          empty_delta: number
          full_delta: number
          id: string
          movement_type: string
          note: string | null
          quantity: number
          stock_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          empty_delta: number
          full_delta: number
          id?: string
          movement_type: string
          note?: string | null
          quantity: number
          stock_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          empty_delta?: number
          full_delta?: number
          id?: string
          movement_type?: string
          note?: string | null
          quantity?: number
          stock_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chinese_stock_movements_stock_id_fkey"
            columns: ["stock_id"]
            isOneToOne: false
            referencedRelation: "chinese_cylinder_stock"
            referencedColumns: ["id"]
          },
        ]
      }
      flaga_cylinder_stock: {
        Row: {
          created_at: string
          empty_count: number
          full_count: number
          gas_type: string
          id: string
          size: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          empty_count?: number
          full_count?: number
          gas_type: string
          id?: string
          size: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          empty_count?: number
          full_count?: number
          gas_type?: string
          id?: string
          size?: string
          updated_at?: string
        }
        Relationships: []
      }
      flaga_stock_movements: {
        Row: {
          created_at: string
          created_by: string | null
          empty_delta: number
          full_delta: number
          id: string
          movement_type: string
          note: string | null
          quantity: number
          stock_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          empty_delta: number
          full_delta: number
          id?: string
          movement_type: string
          note?: string | null
          quantity: number
          stock_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          empty_delta?: number
          full_delta?: number
          id?: string
          movement_type?: string
          note?: string | null
          quantity?: number
          stock_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "flaga_stock_movements_stock_id_fkey"
            columns: ["stock_id"]
            isOneToOne: false
            referencedRelation: "flaga_cylinder_stock"
            referencedColumns: ["id"]
          },
        ]
      }
      flaga_pb_stock: {
        Row: {
          created_at: string
          empty_count: number
          full_count: number
          gas_type: string
          id: string
          size: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          empty_count?: number
          full_count?: number
          gas_type: string
          id?: string
          size: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          empty_count?: number
          full_count?: number
          gas_type?: string
          id?: string
          size?: string
          updated_at?: string
        }
        Relationships: []
      }
      flaga_pb_stock_movements: {
        Row: {
          created_at: string
          created_by: string | null
          empty_delta: number
          full_delta: number
          id: string
          movement_type: string
          note: string | null
          quantity: number
          stock_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          empty_delta: number
          full_delta: number
          id?: string
          movement_type: string
          note?: string | null
          quantity: number
          stock_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          empty_delta?: number
          full_delta?: number
          id?: string
          movement_type?: string
          note?: string | null
          quantity?: number
          stock_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "flaga_pb_stock_movements_stock_id_fkey"
            columns: ["stock_id"]
            isOneToOne: false
            referencedRelation: "flaga_pb_stock"
            referencedColumns: ["id"]
          },
        ]
      }
      prima_pb_stock: {
        Row: {
          created_at: string
          empty_count: number
          full_count: number
          gas_type: string
          id: string
          size: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          empty_count?: number
          full_count?: number
          gas_type: string
          id?: string
          size: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          empty_count?: number
          full_count?: number
          gas_type?: string
          id?: string
          size?: string
          updated_at?: string
        }
        Relationships: []
      }
      prima_pb_stock_movements: {
        Row: {
          created_at: string
          created_by: string | null
          empty_delta: number
          full_delta: number
          id: string
          movement_type: string
          note: string | null
          quantity: number
          stock_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          empty_delta: number
          full_delta: number
          id?: string
          movement_type: string
          note?: string | null
          quantity: number
          stock_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          empty_delta?: number
          full_delta?: number
          id?: string
          movement_type?: string
          note?: string | null
          quantity?: number
          stock_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "prima_pb_stock_movements_stock_id_fkey"
            columns: ["stock_id"]
            isOneToOne: false
            referencedRelation: "prima_pb_stock"
            referencedColumns: ["id"]
          },
        ]
      }
      cylinders: {
        Row: {
          active: boolean
          barcode: string
          category: string | null
          circulation: Database["public"]["Enums"]["circulation"]
          created_at: string
          factory_serial: string | null
          first_tracked_at: string | null
          gas_type: string
          id: string
          is_temporary: boolean
          last_movement_at: string | null
          location_partner_id: string | null
          location_supplier_id: string | null
          location_type: Database["public"]["Enums"]["location_type"]
          manufacturer: Database["public"]["Enums"]["cylinder_manufacturer"]
          note: string | null
          owner: Database["public"]["Enums"]["circulation"]
          photo_url: string | null
          pressure_test_year: number | null
          rental_id: string | null
          replacement_value: number
          size: string
          status: Database["public"]["Enums"]["cyl_status"]
          updated_at: string
        }
        Insert: {
          active?: boolean
          barcode: string
          category?: string | null
          circulation: Database["public"]["Enums"]["circulation"]
          created_at?: string
          factory_serial?: string | null
          first_tracked_at?: string | null
          gas_type: string
          id?: string
          is_temporary?: boolean
          last_movement_at?: string | null
          location_partner_id?: string | null
          location_supplier_id?: string | null
          location_type?: Database["public"]["Enums"]["location_type"]
          manufacturer?: Database["public"]["Enums"]["cylinder_manufacturer"]
          note?: string | null
          owner?: Database["public"]["Enums"]["circulation"]
          photo_url?: string | null
          pressure_test_year?: number | null
          rental_id?: string | null
          replacement_value?: number
          size: string
          status?: Database["public"]["Enums"]["cyl_status"]
          updated_at?: string
        }
        Update: {
          active?: boolean
          barcode?: string
          category?: string | null
          circulation?: Database["public"]["Enums"]["circulation"]
          created_at?: string
          factory_serial?: string | null
          first_tracked_at?: string | null
          gas_type?: string
          id?: string
          is_temporary?: boolean
          last_movement_at?: string | null
          location_partner_id?: string | null
          location_supplier_id?: string | null
          location_type?: Database["public"]["Enums"]["location_type"]
          manufacturer?: Database["public"]["Enums"]["cylinder_manufacturer"]
          note?: string | null
          owner?: Database["public"]["Enums"]["circulation"]
          photo_url?: string | null
          pressure_test_year?: number | null
          rental_id?: string | null
          replacement_value?: number
          size?: string
          status?: Database["public"]["Enums"]["cyl_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cylinders_location_partner_id_fkey"
            columns: ["location_partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cylinders_location_supplier_id_fkey"
            columns: ["location_supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cylinders_rental_id_fkey"
            columns: ["rental_id"]
            isOneToOne: false
            referencedRelation: "rentals"
            referencedColumns: ["id"]
          },
        ]
      }
      cylinder_history: {
        Row: {
          created_at: string
          created_by: string | null
          cylinder_id: string
          description: string | null
          document_url: string | null
          event_type: string
          id: string
          ip_address: unknown
          metadata: Json
          new_value: string | null
          old_value: string | null
          partner_id: string | null
          photo_url: string | null
          pressure_test_certificate_url: string | null
          user_note: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          cylinder_id: string
          description?: string | null
          document_url?: string | null
          event_type: string
          id?: string
          ip_address?: unknown
          metadata?: Json
          new_value?: string | null
          old_value?: string | null
          partner_id?: string | null
          photo_url?: string | null
          pressure_test_certificate_url?: string | null
          user_note?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          cylinder_id?: string
          description?: string | null
          document_url?: string | null
          event_type?: string
          id?: string
          ip_address?: unknown
          metadata?: Json
          new_value?: string | null
          old_value?: string | null
          partner_id?: string | null
          photo_url?: string | null
          pressure_test_certificate_url?: string | null
          user_note?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cylinder_history_cylinder_id_fkey"
            columns: ["cylinder_id"]
            isOneToOne: false
            referencedRelation: "cylinders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cylinder_history_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
        ]
      }
      cylinder_loans: {
        Row: {
          created_at: string
          created_by: string | null
          cylinder_id: string
          exchange_id: string | null
          id: string
          loaned_at: string
          note: string | null
          partner_id: string
          return_note: string | null
          returned_at: string | null
          returned_cylinder_id: string | null
          status: Database["public"]["Enums"]["cylinder_loan_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          cylinder_id: string
          exchange_id?: string | null
          id?: string
          loaned_at?: string
          note?: string | null
          partner_id: string
          return_note?: string | null
          returned_at?: string | null
          returned_cylinder_id?: string | null
          status?: Database["public"]["Enums"]["cylinder_loan_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          cylinder_id?: string
          exchange_id?: string | null
          id?: string
          loaned_at?: string
          note?: string | null
          partner_id?: string
          return_note?: string | null
          returned_at?: string | null
          returned_cylinder_id?: string | null
          status?: Database["public"]["Enums"]["cylinder_loan_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cylinder_loans_cylinder_id_fkey"
            columns: ["cylinder_id"]
            isOneToOne: false
            referencedRelation: "cylinders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cylinder_loans_exchange_id_fkey"
            columns: ["exchange_id"]
            isOneToOne: false
            referencedRelation: "exchanges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cylinder_loans_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cylinder_loans_returned_cylinder_id_fkey"
            columns: ["returned_cylinder_id"]
            isOneToOne: false
            referencedRelation: "cylinders"
            referencedColumns: ["id"]
          },
        ]
      }
      exchanges: {
        Row: {
          beszerzesi_ar: number | null
          created_at: string
          created_by: string | null
          eladasi_ar: number | null
          id: string
          incoming_circulation: Database["public"]["Enums"]["circulation"]
          incoming_cylinder_id: string | null
          invoiced: boolean
          invoiced_at: string | null
          is_forced_substitution: boolean
          note: string | null
          operation_type: Database["public"]["Enums"]["exchange_operation_type"]
          outgoing_circulation: Database["public"]["Enums"]["circulation"]
          outgoing_cylinder_id: string | null
          partner_id: string
          profit: number | null
          reason: string | null
          rental_id: string | null
          rental_reassigned: boolean
        }
        Insert: {
          beszerzesi_ar?: number | null
          created_at?: string
          created_by?: string | null
          eladasi_ar?: number | null
          id?: string
          incoming_circulation: Database["public"]["Enums"]["circulation"]
          incoming_cylinder_id?: string | null
          invoiced?: boolean
          invoiced_at?: string | null
          is_forced_substitution?: boolean
          note?: string | null
          operation_type?: Database["public"]["Enums"]["exchange_operation_type"]
          outgoing_circulation: Database["public"]["Enums"]["circulation"]
          outgoing_cylinder_id?: string | null
          partner_id: string
          profit?: number | null
          reason?: string | null
          rental_id?: string | null
          rental_reassigned?: boolean
        }
        Update: {
          beszerzesi_ar?: number | null
          created_at?: string
          created_by?: string | null
          eladasi_ar?: number | null
          id?: string
          incoming_circulation?: Database["public"]["Enums"]["circulation"]
          incoming_cylinder_id?: string | null
          invoiced?: boolean
          invoiced_at?: string | null
          is_forced_substitution?: boolean
          note?: string | null
          operation_type?: Database["public"]["Enums"]["exchange_operation_type"]
          outgoing_circulation?: Database["public"]["Enums"]["circulation"]
          outgoing_cylinder_id?: string | null
          partner_id?: string
          profit?: number | null
          reason?: string | null
          rental_id?: string | null
          rental_reassigned?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "exchanges_incoming_cylinder_id_fkey"
            columns: ["incoming_cylinder_id"]
            isOneToOne: false
            referencedRelation: "cylinders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exchanges_outgoing_cylinder_id_fkey"
            columns: ["outgoing_cylinder_id"]
            isOneToOne: false
            referencedRelation: "cylinders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exchanges_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
        ]
      }
      gas_order_items: {
        Row: {
          barcode: string
          beszerzesi_ar: number | null
          circulation: Database["public"]["Enums"]["circulation"]
          created_at: string
          cylinder_id: string | null
          gas_order_id: string
          gas_type: string
          id: string
          size: string
        }
        Insert: {
          barcode: string
          beszerzesi_ar?: number | null
          circulation: Database["public"]["Enums"]["circulation"]
          created_at?: string
          cylinder_id?: string | null
          gas_order_id: string
          gas_type: string
          id?: string
          size: string
        }
        Update: {
          barcode?: string
          beszerzesi_ar?: number | null
          circulation?: Database["public"]["Enums"]["circulation"]
          created_at?: string
          cylinder_id?: string | null
          gas_order_id?: string
          gas_type?: string
          id?: string
          size?: string
        }
        Relationships: [
          {
            foreignKeyName: "gas_order_items_cylinder_id_fkey"
            columns: ["cylinder_id"]
            isOneToOne: false
            referencedRelation: "cylinders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gas_order_items_gas_order_id_fkey"
            columns: ["gas_order_id"]
            isOneToOne: false
            referencedRelation: "gas_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      gas_order_quantity_items: {
        Row: {
          beszerzesi_ar: number | null
          created_at: string
          gas_order_id: string
          gas_type: string
          id: string
          quantity: number
          size: string
          stock_kind: string
        }
        Insert: {
          beszerzesi_ar?: number | null
          created_at?: string
          gas_order_id: string
          gas_type: string
          id?: string
          quantity: number
          size: string
          stock_kind: string
        }
        Update: {
          beszerzesi_ar?: number | null
          created_at?: string
          gas_order_id?: string
          gas_type?: string
          id?: string
          quantity?: number
          size?: string
          stock_kind?: string
        }
        Relationships: [
          {
            foreignKeyName: "gas_order_quantity_items_gas_order_id_fkey"
            columns: ["gas_order_id"]
            isOneToOne: false
            referencedRelation: "gas_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      gas_orders: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          note: string | null
          order_kind: string
          status: Database["public"]["Enums"]["gas_order_status"]
          stock_applied_at: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          note?: string | null
          order_kind?: string
          status?: Database["public"]["Enums"]["gas_order_status"]
          stock_applied_at?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          note?: string | null
          order_kind?: string
          status?: Database["public"]["Enums"]["gas_order_status"]
          stock_applied_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      movements: {
        Row: {
          created_at: string
          created_by: string | null
          cylinder_id: string
          from_location: Database["public"]["Enums"]["location_type"] | null
          from_partner_id: string | null
          from_supplier_id: string | null
          id: string
          note: string | null
          status_after: Database["public"]["Enums"]["cyl_status"]
          to_location: Database["public"]["Enums"]["location_type"]
          to_partner_id: string | null
          to_supplier_id: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          cylinder_id: string
          from_location?: Database["public"]["Enums"]["location_type"] | null
          from_partner_id?: string | null
          from_supplier_id?: string | null
          id?: string
          note?: string | null
          status_after: Database["public"]["Enums"]["cyl_status"]
          to_location: Database["public"]["Enums"]["location_type"]
          to_partner_id?: string | null
          to_supplier_id?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          cylinder_id?: string
          from_location?: Database["public"]["Enums"]["location_type"] | null
          from_partner_id?: string | null
          from_supplier_id?: string | null
          id?: string
          note?: string | null
          status_after?: Database["public"]["Enums"]["cyl_status"]
          to_location?: Database["public"]["Enums"]["location_type"]
          to_partner_id?: string | null
          to_supplier_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "movements_cylinder_id_fkey"
            columns: ["cylinder_id"]
            isOneToOne: false
            referencedRelation: "cylinders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "movements_from_partner_id_fkey"
            columns: ["from_partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "movements_from_supplier_id_fkey"
            columns: ["from_supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "movements_to_partner_id_fkey"
            columns: ["to_partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "movements_to_supplier_id_fkey"
            columns: ["to_supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      partners: {
        Row: {
          address: string | null
          address_card_number: string | null
          birth_date: string | null
          birth_place: string | null
          company_name: string | null
          contact_person: string | null
          created_at: string
          email: string | null
          id: string
          id_number: string | null
          mother_name: string | null
          name: string
          note: string | null
          phone: string | null
          tax_number: string | null
          type: Database["public"]["Enums"]["partner_type"]
          updated_at: string
        }
        Insert: {
          address?: string | null
          address_card_number?: string | null
          birth_date?: string | null
          birth_place?: string | null
          company_name?: string | null
          contact_person?: string | null
          created_at?: string
          email?: string | null
          id?: string
          id_number?: string | null
          mother_name?: string | null
          name: string
          note?: string | null
          phone?: string | null
          tax_number?: string | null
          type?: Database["public"]["Enums"]["partner_type"]
          updated_at?: string
        }
        Update: {
          address?: string | null
          address_card_number?: string | null
          birth_date?: string | null
          birth_place?: string | null
          company_name?: string | null
          contact_person?: string | null
          created_at?: string
          email?: string | null
          id?: string
          id_number?: string | null
          mother_name?: string | null
          name?: string
          note?: string | null
          phone?: string | null
          tax_number?: string | null
          type?: Database["public"]["Enums"]["partner_type"]
          updated_at?: string
        }
        Relationships: []
      }
      product_prices: {
        Row: {
          active: boolean
          arres: number
          beszerzesi_ar: number
          created_at: string
          currency: string
          eladasi_ar: number
          gas_type: string
          id: string
          note: string | null
          product_code: string | null
          size: string
          unit_price: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          arres?: number
          beszerzesi_ar: number
          created_at?: string
          currency?: string
          eladasi_ar?: number
          gas_type: string
          id?: string
          note?: string | null
          product_code?: string | null
          size: string
          unit_price?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          arres?: number
          beszerzesi_ar?: number
          created_at?: string
          currency?: string
          eladasi_ar?: number
          gas_type?: string
          id?: string
          note?: string | null
          product_code?: string | null
          size?: string
          unit_price?: number
          updated_at?: string
        }
        Relationships: []
      }
      quote_items: {
        Row: {
          created_at: string
          discount_percent: number
          gas_type: string
          id: string
          is_custom_price: boolean
          list_price: number
          quantity: number
          quote_id: string
          size: string
          sort_order: number
          unit_price: number
        }
        Insert: {
          created_at?: string
          discount_percent?: number
          gas_type: string
          id?: string
          is_custom_price?: boolean
          list_price: number
          quantity: number
          quote_id: string
          size: string
          sort_order?: number
          unit_price: number
        }
        Update: {
          created_at?: string
          discount_percent?: number
          gas_type?: string
          id?: string
          is_custom_price?: boolean
          list_price?: number
          quantity?: number
          quote_id?: string
          size?: string
          sort_order?: number
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "quote_items_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "quotes"
            referencedColumns: ["id"]
          },
        ]
      }
      quotes: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          note: string | null
          partner_id: string
          quote_date: string
          quote_number: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          note?: string | null
          partner_id: string
          quote_date?: string
          quote_number: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          note?: string | null
          partner_id?: string
          quote_date?: string
          quote_number?: string
        }
        Relationships: [
          {
            foreignKeyName: "quotes_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      rental_quantity_items: {
        Row: {
          added_at: string
          gas_type: string
          id: string
          quantity: number
          removed_at: string | null
          rental_id: string
          size: string
          stock_kind: string
        }
        Insert: {
          added_at?: string
          gas_type: string
          id?: string
          quantity: number
          removed_at?: string | null
          rental_id: string
          size: string
          stock_kind: string
        }
        Update: {
          added_at?: string
          gas_type?: string
          id?: string
          quantity?: number
          removed_at?: string | null
          rental_id?: string
          size?: string
          stock_kind?: string
        }
        Relationships: [
          {
            foreignKeyName: "rental_quantity_items_rental_id_fkey"
            columns: ["rental_id"]
            isOneToOne: false
            referencedRelation: "rentals"
            referencedColumns: ["id"]
          },
        ]
      }
      rental_cylinders: {
        Row: {
          added_at: string
          cylinder_id: string
          expiry_date: string | null
          removed_at: string | null
          rental_deposit: number | null
          rental_end_date: string | null
          rental_id: string
          rental_start_date: string | null
        }
        Insert: {
          added_at?: string
          cylinder_id: string
          expiry_date?: string | null
          removed_at?: string | null
          rental_deposit?: number | null
          rental_end_date?: string | null
          rental_id: string
          rental_start_date?: string | null
        }
        Update: {
          added_at?: string
          cylinder_id?: string
          expiry_date?: string | null
          removed_at?: string | null
          rental_deposit?: number | null
          rental_end_date?: string | null
          rental_id?: string
          rental_start_date?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "rental_cylinders_cylinder_id_fkey"
            columns: ["cylinder_id"]
            isOneToOne: false
            referencedRelation: "cylinders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rental_cylinders_rental_id_fkey"
            columns: ["rental_id"]
            isOneToOne: false
            referencedRelation: "rentals"
            referencedColumns: ["id"]
          },
        ]
      }
      rental_invoices: {
        Row: {
          amount: number
          created_at: string
          id: string
          paid: boolean
          period_month: string
          rental_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          id?: string
          paid?: boolean
          period_month: string
          rental_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          id?: string
          paid?: boolean
          period_month?: string
          rental_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "rental_invoices_rental_id_fkey"
            columns: ["rental_id"]
            isOneToOne: false
            referencedRelation: "rentals"
            referencedColumns: ["id"]
          },
        ]
      }
      rental_reassignments: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          new_cylinder_id: string
          note: string | null
          old_cylinder_id: string | null
          rental_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          new_cylinder_id: string
          note?: string | null
          old_cylinder_id?: string | null
          rental_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          new_cylinder_id?: string
          note?: string | null
          old_cylinder_id?: string | null
          rental_id?: string
        }
        Relationships: []
      }
      rentals: {
        Row: {
          billing_cycle_months: number
          circulation: Database["public"]["Enums"]["circulation"] | null
          contract_number: string | null
          contract_pdf_url: string | null
          created_at: string
          current_cylinder_id: string | null
          deposit: number
          deposit_type: string | null
          end_date: string | null
          expiry_date: string | null
          first_invoice_date: string | null
          id: string
          monthly_fee: number
          next_invoice_date: string | null
          note: string | null
          original_cylinder_id: string | null
          partner_id: string
          rental_type: Database["public"]["Enums"]["rental_type"]
          signature_data: string | null
          signed_at: string | null
          signed_pdf_url: string | null
          start_date: string
          status: string
          updated_at: string
        }
        Insert: {
          billing_cycle_months?: number
          circulation?: Database["public"]["Enums"]["circulation"] | null
          contract_number?: string | null
          contract_pdf_url?: string | null
          created_at?: string
          current_cylinder_id?: string | null
          deposit?: number
          deposit_type?: string | null
          end_date?: string | null
          expiry_date?: string | null
          first_invoice_date?: string | null
          id?: string
          monthly_fee?: number
          next_invoice_date?: string | null
          note?: string | null
          original_cylinder_id?: string | null
          partner_id: string
          rental_type?: Database["public"]["Enums"]["rental_type"]
          signature_data?: string | null
          signed_at?: string | null
          signed_pdf_url?: string | null
          start_date?: string
          status?: string
          updated_at?: string
        }
        Update: {
          billing_cycle_months?: number
          circulation?: Database["public"]["Enums"]["circulation"] | null
          contract_number?: string | null
          contract_pdf_url?: string | null
          created_at?: string
          current_cylinder_id?: string | null
          deposit?: number
          deposit_type?: string | null
          end_date?: string | null
          expiry_date?: string | null
          first_invoice_date?: string | null
          id?: string
          monthly_fee?: number
          next_invoice_date?: string | null
          note?: string | null
          original_cylinder_id?: string | null
          partner_id?: string
          rental_type?: Database["public"]["Enums"]["rental_type"]
          signature_data?: string | null
          signed_at?: string | null
          signed_pdf_url?: string | null
          start_date?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "rentals_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
        ]
      }
      supplier_exchanges: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          note: string | null
          received_cylinder_ids: string[]
          returned_cylinder_ids: string[]
          supplier_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          note?: string | null
          received_cylinder_ids?: string[]
          returned_cylinder_ids?: string[]
          supplier_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          note?: string | null
          received_cylinder_ids?: string[]
          returned_cylinder_ids?: string[]
          supplier_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "supplier_exchanges_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      suppliers: {
        Row: {
          created_at: string
          id: string
          kind: Database["public"]["Enums"]["location_type"]
          name: string
          note: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          kind: Database["public"]["Enums"]["location_type"]
          name: string
          note?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          kind?: Database["public"]["Enums"]["location_type"]
          name?: string
          note?: string | null
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      adjust_chinese_stock: {
        Args: {
          p_gas_type: string
          p_movement_type: string
          p_note?: string
          p_quantity: number
          p_size: string
        }
        Returns: string
      }
      adjust_flaga_stock: {
        Args: {
          p_gas_type: string
          p_movement_type: string
          p_note?: string
          p_quantity: number
          p_size: string
        }
        Returns: string
      }
      adjust_flaga_pb_stock: {
        Args: {
          p_gas_type: string
          p_movement_type: string
          p_note?: string
          p_quantity: number
          p_size: string
        }
        Returns: string
      }
      adjust_prima_pb_stock: {
        Args: {
          p_gas_type: string
          p_movement_type: string
          p_note?: string
          p_quantity: number
          p_size: string
        }
        Returns: string
      }
      close_rental: {
        Args: {
          p_deposit_returned: boolean
          p_note?: string
          p_rental_id: string
          p_returned_barcode: string
          p_status?: string
        }
        Returns: undefined
      }
      next_rental_contract_number: {
        Args: { p_start_date: string }
        Returns: string
      }
      receive_gas_order: {
        Args: { p_order_id: string }
        Returns: undefined
      }
      find_or_create_cylinder: {
        Args: {
          p_barcode: string
          p_circulation?: Database["public"]["Enums"]["circulation"]
          p_gas_type?: string
          p_location_type?: Database["public"]["Enums"]["location_type"]
          p_owner?: Database["public"]["Enums"]["circulation"]
          p_size?: string
          p_status?: Database["public"]["Enums"]["cyl_status"]
        }
        Returns: {
          created: boolean
          cylinder: Database["public"]["Tables"]["cylinders"]["Row"]
        }[]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      next_temp_barcode: { Args: never; Returns: string }
      reassign_rental_cylinder: {
        Args: {
          p_new_cylinder_id: string
          p_note?: string
          p_rental_id: string
        }
        Returns: undefined
      }
      record_exchange: {
        Args: {
          p_incoming_id: string
          p_note?: string
          p_outgoing_id: string
          p_partner_id: string
          p_reason?: string
          p_reassign_rental?: boolean
          p_rental_id?: string
        }
        Returns: string
      }
      record_empty_return: {
        Args: {
          p_incoming_id: string
          p_note?: string
          p_partner_id: string
        }
        Returns: string
      }
      record_cylinder_loan: {
        Args: {
          p_note?: string
          p_outgoing_id: string
          p_partner_id: string
        }
        Returns: string
      }
      return_cylinder_loan: {
        Args: {
          p_loan_id: string
          p_note?: string
          p_returned_cylinder_id: string
        }
        Returns: undefined
      }
      record_partner_sale: {
        Args: {
          p_note?: string
          p_outgoing_id: string
          p_partner_id: string
        }
        Returns: string
      }
      record_supplier_exchange: {
        Args: {
          p_note?: string
          p_received_barcodes: string[]
          p_returned_barcodes: string[]
          p_supplier_id: string
        }
        Returns: string
      }
    }
    Enums: {
      app_role: "admin" | "user"
      circulation: "siad" | "own" | "berpalack"
      cylinder_loan_status: "active" | "returned"
      cylinder_manufacturer: "siad" | "messer" | "linde" | "chinese" | "other"
      exchange_operation_type:
        | "exchange"
        | "sale"
        | "empty_return"
        | "loan"
        | "chinese_sale"
        | "chinese_brought"
        | "chinese_take"
        | "flaga_sale"
        | "flaga_pb_sale"
        | "prima_pb_sale"
      circulation_difference_status: "open" | "partially_settled" | "closed"
      cyl_status: "full" | "empty" | "service"
      gas_order_status: "planned" | "ordered" | "received"
      location_type:
        | "warehouse_full"
        | "warehouse_empty"
        | "customer"
        | "siad"
        | "own_supplier"
      partner_type: "company" | "private"
      rental_type: "yearly" | "monthly" | "free"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "user"],
      circulation: ["siad", "own", "berpalack"],
      cylinder_manufacturer: ["siad", "messer", "linde", "chinese", "other"],
      cyl_status: ["full", "empty", "service"],
      gas_order_status: ["planned", "ordered", "received"],
      location_type: [
        "warehouse_full",
        "warehouse_empty",
        "customer",
        "siad",
        "own_supplier",
      ],
      partner_type: ["company", "private"],
      rental_type: ["yearly", "monthly", "free"],
    },
  },
} as const
