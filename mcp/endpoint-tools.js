// Auto-generated from docs/reference/bc3-api sections

export const ENDPOINT_TOOLS = [
  {
    "name": "api_get_buckets_by_bucket_id_card_tables_by_card_table_id",
    "method": "GET",
    "path": "/buckets/{bucket_id}/card_tables/{card_table_id}.json",
    "description": "Raw endpoint wrapper: GET /buckets/{bucket_id}/card_tables/{card_table_id}.json",
    "inputSchema": {
      "type": "object",
      "properties": {
        "bucket_id": {
          "type": [
            "integer",
            "string"
          ]
        },
        "card_table_id": {
          "type": [
            "integer",
            "string"
          ]
        },
        "query": {
          "type": "object",
          "additionalProperties": true,
          "nullable": true
        },
        "body": {
          "type": "object",
          "additionalProperties": true,
          "nullable": true
        },
        "paginate": {
          "type": "boolean",
          "nullable": true
        },
        "idempotency_key": {
          "type": "string",
          "nullable": true
        }
      },
      "required": [
        "bucket_id",
        "card_table_id"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "api_get_buckets_by_bucket_id_card_tables_cards_by_card_id",
    "method": "GET",
    "path": "/buckets/{bucket_id}/card_tables/cards/{card_id}.json",
    "description": "Raw endpoint wrapper: GET /buckets/{bucket_id}/card_tables/cards/{card_id}.json",
    "inputSchema": {
      "type": "object",
      "properties": {
        "bucket_id": {
          "type": [
            "integer",
            "string"
          ]
        },
        "card_id": {
          "type": [
            "integer",
            "string"
          ]
        },
        "query": {
          "type": "object",
          "additionalProperties": true,
          "nullable": true
        },
        "body": {
          "type": "object",
          "additionalProperties": true,
          "nullable": true
        },
        "paginate": {
          "type": "boolean",
          "nullable": true
        },
        "idempotency_key": {
          "type": "string",
          "nullable": true
        }
      },
      "required": [
        "bucket_id",
        "card_id"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "api_get_buckets_by_bucket_id_card_tables_columns_by_id",
    "method": "GET",
    "path": "/buckets/{bucket_id}/card_tables/columns/{id}.json",
    "description": "Raw endpoint wrapper: GET /buckets/{bucket_id}/card_tables/columns/{id}.json",
    "inputSchema": {
      "type": "object",
      "properties": {
        "bucket_id": {
          "type": [
            "integer",
            "string"
          ]
        },
        "id": {
          "type": [
            "integer",
            "string"
          ]
        },
        "query": {
          "type": "object",
          "additionalProperties": true,
          "nullable": true
        },
        "body": {
          "type": "object",
          "additionalProperties": true,
          "nullable": true
        },
        "paginate": {
          "type": "boolean",
          "nullable": true
        },
        "idempotency_key": {
          "type": "string",
          "nullable": true
        }
      },
      "required": [
        "bucket_id",
        "id"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "api_get_buckets_by_bucket_id_card_tables_lists_by_column_id_cards",
    "method": "GET",
    "path": "/buckets/{bucket_id}/card_tables/lists/{column_id}/cards.json",
    "description": "Raw endpoint wrapper: GET /buckets/{bucket_id}/card_tables/lists/{column_id}/cards.json",
    "inputSchema": {
      "type": "object",
      "properties": {
        "bucket_id": {
          "type": [
            "integer",
            "string"
          ]
        },
        "column_id": {
          "type": [
            "integer",
            "string"
          ]
        },
        "query": {
          "type": "object",
          "additionalProperties": true,
          "nullable": true
        },
        "body": {
          "type": "object",
          "additionalProperties": true,
          "nullable": true
        },
        "paginate": {
          "type": "boolean",
          "nullable": true
        },
        "idempotency_key": {
          "type": "string",
          "nullable": true
        }
      },
      "required": [
        "bucket_id",
        "column_id"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "api_get_buckets_by_bucket_id_categories",
    "method": "GET",
    "path": "/buckets/{bucket_id}/categories.json",
    "description": "Raw endpoint wrapper: GET /buckets/{bucket_id}/categories.json",
    "inputSchema": {
      "type": "object",
      "properties": {
        "bucket_id": {
          "type": [
            "integer",
            "string"
          ]
        },
        "query": {
          "type": "object",
          "additionalProperties": true,
          "nullable": true
        },
        "body": {
          "type": "object",
          "additionalProperties": true,
          "nullable": true
        },
        "paginate": {
          "type": "boolean",
          "nullable": true
        },
        "idempotency_key": {
          "type": "string",
          "nullable": true
        }
      },
      "required": [
        "bucket_id"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "api_get_buckets_by_bucket_id_categories_by_id",
    "method": "GET",
    "path": "/buckets/{bucket_id}/categories/{id}.json",
    "description": "Raw endpoint wrapper: GET /buckets/{bucket_id}/categories/{id}.json",
    "inputSchema": {
      "type": "object",
      "properties": {
        "bucket_id": {
          "type": [
            "integer",
            "string"
          ]
        },
        "id": {
          "type": [
            "integer",
            "string"
          ]
        },
        "query": {
          "type": "object",
          "additionalProperties": true,
          "nullable": true
        },
        "body": {
          "type": "object",
          "additionalProperties": true,
          "nullable": true
        },
        "paginate": {
          "type": "boolean",
          "nullable": true
        },
        "idempotency_key": {
          "type": "string",
          "nullable": true
        }
      },
      "required": [
        "bucket_id",
        "id"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "api_get_buckets_by_bucket_id_chats_by_id",
    "method": "GET",
    "path": "/buckets/{bucket_id}/chats/{id}.json",
    "description": "Raw endpoint wrapper: GET /buckets/{bucket_id}/chats/{id}.json",
    "inputSchema": {
      "type": "object",
      "properties": {
        "bucket_id": {
          "type": [
            "integer",
            "string"
          ]
        },
        "id": {
          "type": [
            "integer",
            "string"
          ]
        },
        "query": {
          "type": "object",
          "additionalProperties": true,
          "nullable": true
        },
        "body": {
          "type": "object",
          "additionalProperties": true,
          "nullable": true
        },
        "paginate": {
          "type": "boolean",
          "nullable": true
        },
        "idempotency_key": {
          "type": "string",
          "nullable": true
        }
      },
      "required": [
        "bucket_id",
        "id"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "api_get_buckets_by_bucket_id_chats_by_id_integrations",
    "method": "GET",
    "path": "/buckets/{bucket_id}/chats/{id}/integrations.json",
    "description": "Raw endpoint wrapper: GET /buckets/{bucket_id}/chats/{id}/integrations.json",
    "inputSchema": {
      "type": "object",
      "properties": {
        "bucket_id": {
          "type": [
            "integer",
            "string"
          ]
        },
        "id": {
          "type": [
            "integer",
            "string"
          ]
        },
        "query": {
          "type": "object",
          "additionalProperties": true,
          "nullable": true
        },
        "body": {
          "type": "object",
          "additionalProperties": true,
          "nullable": true
        },
        "paginate": {
          "type": "boolean",
          "nullable": true
        },
        "idempotency_key": {
          "type": "string",
          "nullable": true
        }
      },
      "required": [
        "bucket_id",
        "id"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "api_get_buckets_by_bucket_id_chats_by_id_integrations_by_integration_id",
    "method": "GET",
    "path": "/buckets/{bucket_id}/chats/{id}/integrations/{integration_id}.json",
    "description": "Raw endpoint wrapper: GET /buckets/{bucket_id}/chats/{id}/integrations/{integration_id}.json",
    "inputSchema": {
      "type": "object",
      "properties": {
        "bucket_id": {
          "type": [
            "integer",
            "string"
          ]
        },
        "id": {
          "type": [
            "integer",
            "string"
          ]
        },
        "integration_id": {
          "type": [
            "integer",
            "string"
          ]
        },
        "query": {
          "type": "object",
          "additionalProperties": true,
          "nullable": true
        },
        "body": {
          "type": "object",
          "additionalProperties": true,
          "nullable": true
        },
        "paginate": {
          "type": "boolean",
          "nullable": true
        },
        "idempotency_key": {
          "type": "string",
          "nullable": true
        }
      },
      "required": [
        "bucket_id",
        "id",
        "integration_id"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "api_get_buckets_by_bucket_id_chats_by_id_lines",
    "method": "GET",
    "path": "/buckets/{bucket_id}/chats/{id}/lines.json",
    "description": "Raw endpoint wrapper: GET /buckets/{bucket_id}/chats/{id}/lines.json",
    "inputSchema": {
      "type": "object",
      "properties": {
        "bucket_id": {
          "type": [
            "integer",
            "string"
          ]
        },
        "id": {
          "type": [
            "integer",
            "string"
          ]
        },
        "query": {
          "type": "object",
          "additionalProperties": true,
          "nullable": true
        },
        "body": {
          "type": "object",
          "additionalProperties": true,
          "nullable": true
        },
        "paginate": {
          "type": "boolean",
          "nullable": true
        },
        "idempotency_key": {
          "type": "string",
          "nullable": true
        }
      },
      "required": [
        "bucket_id",
        "id"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "api_get_buckets_by_bucket_id_chats_by_id_lines_by_id",
    "method": "GET",
    "path": "/buckets/{bucket_id}/chats/{id}/lines/{id}.json",
    "description": "Raw endpoint wrapper: GET /buckets/{bucket_id}/chats/{id}/lines/{id}.json",
    "inputSchema": {
      "type": "object",
      "properties": {
        "bucket_id": {
          "type": [
            "integer",
            "string"
          ]
        },
        "id": {
          "type": [
            "integer",
            "string"
          ]
        },
        "query": {
          "type": "object",
          "additionalProperties": true,
          "nullable": true
        },
        "body": {
          "type": "object",
          "additionalProperties": true,
          "nullable": true
        },
        "paginate": {
          "type": "boolean",
          "nullable": true
        },
        "idempotency_key": {
          "type": "string",
          "nullable": true
        }
      },
      "required": [
        "bucket_id",
        "id",
        "id"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "api_get_buckets_by_bucket_id_client_approvals",
    "method": "GET",
    "path": "/buckets/{bucket_id}/client/approvals.json",
    "description": "Raw endpoint wrapper: GET /buckets/{bucket_id}/client/approvals.json",
    "inputSchema": {
      "type": "object",
      "properties": {
        "bucket_id": {
          "type": [
            "integer",
            "string"
          ]
        },
        "query": {
          "type": "object",
          "additionalProperties": true,
          "nullable": true
        },
        "body": {
          "type": "object",
          "additionalProperties": true,
          "nullable": true
        },
        "paginate": {
          "type": "boolean",
          "nullable": true
        },
        "idempotency_key": {
          "type": "string",
          "nullable": true
        }
      },
      "required": [
        "bucket_id"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "api_get_buckets_by_bucket_id_client_approvals_by_approval_id",
    "method": "GET",
    "path": "/buckets/{bucket_id}/client/approvals/{approval_id}.json",
    "description": "Raw endpoint wrapper: GET /buckets/{bucket_id}/client/approvals/{approval_id}.json",
    "inputSchema": {
      "type": "object",
      "properties": {
        "bucket_id": {
          "type": [
            "integer",
            "string"
          ]
        },
        "approval_id": {
          "type": [
            "integer",
            "string"
          ]
        },
        "query": {
          "type": "object",
          "additionalProperties": true,
          "nullable": true
        },
        "body": {
          "type": "object",
          "additionalProperties": true,
          "nullable": true
        },
        "paginate": {
          "type": "boolean",
          "nullable": true
        },
        "idempotency_key": {
          "type": "string",
          "nullable": true
        }
      },
      "required": [
        "bucket_id",
        "approval_id"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "api_get_buckets_by_bucket_id_client_correspondences",
    "method": "GET",
    "path": "/buckets/{bucket_id}/client/correspondences.json",
    "description": "Raw endpoint wrapper: GET /buckets/{bucket_id}/client/correspondences.json",
    "inputSchema": {
      "type": "object",
      "properties": {
        "bucket_id": {
          "type": [
            "integer",
            "string"
          ]
        },
        "query": {
          "type": "object",
          "additionalProperties": true,
          "nullable": true
        },
        "body": {
          "type": "object",
          "additionalProperties": true,
          "nullable": true
        },
        "paginate": {
          "type": "boolean",
          "nullable": true
        },
        "idempotency_key": {
          "type": "string",
          "nullable": true
        }
      },
      "required": [
        "bucket_id"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "api_get_buckets_by_bucket_id_client_correspondences_by_correspondence_id",
    "method": "GET",
    "path": "/buckets/{bucket_id}/client/correspondences/{correspondence_id}.json",
    "description": "Raw endpoint wrapper: GET /buckets/{bucket_id}/client/correspondences/{correspondence_id}.json",
    "inputSchema": {
      "type": "object",
      "properties": {
        "bucket_id": {
          "type": [
            "integer",
            "string"
          ]
        },
        "correspondence_id": {
          "type": [
            "integer",
            "string"
          ]
        },
        "query": {
          "type": "object",
          "additionalProperties": true,
          "nullable": true
        },
        "body": {
          "type": "object",
          "additionalProperties": true,
          "nullable": true
        },
        "paginate": {
          "type": "boolean",
          "nullable": true
        },
        "idempotency_key": {
          "type": "string",
          "nullable": true
        }
      },
      "required": [
        "bucket_id",
        "correspondence_id"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "api_get_buckets_by_bucket_id_client_recordings_by_recording_id_replies",
    "method": "GET",
    "path": "/buckets/{bucket_id}/client/recordings/{recording_id}/replies.json",
    "description": "Raw endpoint wrapper: GET /buckets/{bucket_id}/client/recordings/{recording_id}/replies.json",
    "inputSchema": {
      "type": "object",
      "properties": {
        "bucket_id": {
          "type": [
            "integer",
            "string"
          ]
        },
        "recording_id": {
          "type": [
            "integer",
            "string"
          ]
        },
        "query": {
          "type": "object",
          "additionalProperties": true,
          "nullable": true
        },
        "body": {
          "type": "object",
          "additionalProperties": true,
          "nullable": true
        },
        "paginate": {
          "type": "boolean",
          "nullable": true
        },
        "idempotency_key": {
          "type": "string",
          "nullable": true
        }
      },
      "required": [
        "bucket_id",
        "recording_id"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "api_get_buckets_by_bucket_id_client_recordings_by_recording_id_replies_by_reply_id",
    "method": "GET",
    "path": "/buckets/{bucket_id}/client/recordings/{recording_id}/replies/{reply_id}.json",
    "description": "Raw endpoint wrapper: GET /buckets/{bucket_id}/client/recordings/{recording_id}/replies/{reply_id}.json",
    "inputSchema": {
      "type": "object",
      "properties": {
        "bucket_id": {
          "type": [
            "integer",
            "string"
          ]
        },
        "recording_id": {
          "type": [
            "integer",
            "string"
          ]
        },
        "reply_id": {
          "type": [
            "integer",
            "string"
          ]
        },
        "query": {
          "type": "object",
          "additionalProperties": true,
          "nullable": true
        },
        "body": {
          "type": "object",
          "additionalProperties": true,
          "nullable": true
        },
        "paginate": {
          "type": "boolean",
          "nullable": true
        },
        "idempotency_key": {
          "type": "string",
          "nullable": true
        }
      },
      "required": [
        "bucket_id",
        "recording_id",
        "reply_id"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "api_get_buckets_by_bucket_id_comments_by_comment_id",
    "method": "GET",
    "path": "/buckets/{bucket_id}/comments/{comment_id}.json",
    "description": "Raw endpoint wrapper: GET /buckets/{bucket_id}/comments/{comment_id}.json",
    "inputSchema": {
      "type": "object",
      "properties": {
        "bucket_id": {
          "type": [
            "integer",
            "string"
          ]
        },
        "comment_id": {
          "type": [
            "integer",
            "string"
          ]
        },
        "query": {
          "type": "object",
          "additionalProperties": true,
          "nullable": true
        },
        "body": {
          "type": "object",
          "additionalProperties": true,
          "nullable": true
        },
        "paginate": {
          "type": "boolean",
          "nullable": true
        },
        "idempotency_key": {
          "type": "string",
          "nullable": true
        }
      },
      "required": [
        "bucket_id",
        "comment_id"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "api_get_buckets_by_bucket_id_dock_tools_by_id",
    "method": "GET",
    "path": "/buckets/{bucket_id}/dock/tools/{id}.json",
    "description": "Raw endpoint wrapper: GET /buckets/{bucket_id}/dock/tools/{id}.json",
    "inputSchema": {
      "type": "object",
      "properties": {
        "bucket_id": {
          "type": [
            "integer",
            "string"
          ]
        },
        "id": {
          "type": [
            "integer",
            "string"
          ]
        },
        "query": {
          "type": "object",
          "additionalProperties": true,
          "nullable": true
        },
        "body": {
          "type": "object",
          "additionalProperties": true,
          "nullable": true
        },
        "paginate": {
          "type": "boolean",
          "nullable": true
        },
        "idempotency_key": {
          "type": "string",
          "nullable": true
        }
      },
      "required": [
        "bucket_id",
        "id"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "api_get_buckets_by_bucket_id_documents_by_document_id",
    "method": "GET",
    "path": "/buckets/{bucket_id}/documents/{document_id}.json",
    "description": "Raw endpoint wrapper: GET /buckets/{bucket_id}/documents/{document_id}.json",
    "inputSchema": {
      "type": "object",
      "properties": {
        "bucket_id": {
          "type": [
            "integer",
            "string"
          ]
        },
        "document_id": {
          "type": [
            "integer",
            "string"
          ]
        },
        "query": {
          "type": "object",
          "additionalProperties": true,
          "nullable": true
        },
        "body": {
          "type": "object",
          "additionalProperties": true,
          "nullable": true
        },
        "paginate": {
          "type": "boolean",
          "nullable": true
        },
        "idempotency_key": {
          "type": "string",
          "nullable": true
        }
      },
      "required": [
        "bucket_id",
        "document_id"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "api_get_buckets_by_bucket_id_inbox_forwards_by_id",
    "method": "GET",
    "path": "/buckets/{bucket_id}/inbox_forwards/{id}.json",
    "description": "Raw endpoint wrapper: GET /buckets/{bucket_id}/inbox_forwards/{id}.json",
    "inputSchema": {
      "type": "object",
      "properties": {
        "bucket_id": {
          "type": [
            "integer",
            "string"
          ]
        },
        "id": {
          "type": [
            "integer",
            "string"
          ]
        },
        "query": {
          "type": "object",
          "additionalProperties": true,
          "nullable": true
        },
        "body": {
          "type": "object",
          "additionalProperties": true,
          "nullable": true
        },
        "paginate": {
          "type": "boolean",
          "nullable": true
        },
        "idempotency_key": {
          "type": "string",
          "nullable": true
        }
      },
      "required": [
        "bucket_id",
        "id"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "api_get_buckets_by_bucket_id_inbox_forwards_by_id_replies",
    "method": "GET",
    "path": "/buckets/{bucket_id}/inbox_forwards/{id}/replies.json",
    "description": "Raw endpoint wrapper: GET /buckets/{bucket_id}/inbox_forwards/{id}/replies.json",
    "inputSchema": {
      "type": "object",
      "properties": {
        "bucket_id": {
          "type": [
            "integer",
            "string"
          ]
        },
        "id": {
          "type": [
            "integer",
            "string"
          ]
        },
        "query": {
          "type": "object",
          "additionalProperties": true,
          "nullable": true
        },
        "body": {
          "type": "object",
          "additionalProperties": true,
          "nullable": true
        },
        "paginate": {
          "type": "boolean",
          "nullable": true
        },
        "idempotency_key": {
          "type": "string",
          "nullable": true
        }
      },
      "required": [
        "bucket_id",
        "id"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "api_get_buckets_by_bucket_id_inbox_forwards_by_id_replies_by_reply_id",
    "method": "GET",
    "path": "/buckets/{bucket_id}/inbox_forwards/{id}/replies/{reply_id}.json",
    "description": "Raw endpoint wrapper: GET /buckets/{bucket_id}/inbox_forwards/{id}/replies/{reply_id}.json",
    "inputSchema": {
      "type": "object",
      "properties": {
        "bucket_id": {
          "type": [
            "integer",
            "string"
          ]
        },
        "id": {
          "type": [
            "integer",
            "string"
          ]
        },
        "reply_id": {
          "type": [
            "integer",
            "string"
          ]
        },
        "query": {
          "type": "object",
          "additionalProperties": true,
          "nullable": true
        },
        "body": {
          "type": "object",
          "additionalProperties": true,
          "nullable": true
        },
        "paginate": {
          "type": "boolean",
          "nullable": true
        },
        "idempotency_key": {
          "type": "string",
          "nullable": true
        }
      },
      "required": [
        "bucket_id",
        "id",
        "reply_id"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "api_get_buckets_by_bucket_id_inboxes_by_inbox_id",
    "method": "GET",
    "path": "/buckets/{bucket_id}/inboxes/{inbox_id}.json",
    "description": "Raw endpoint wrapper: GET /buckets/{bucket_id}/inboxes/{inbox_id}.json",
    "inputSchema": {
      "type": "object",
      "properties": {
        "bucket_id": {
          "type": [
            "integer",
            "string"
          ]
        },
        "inbox_id": {
          "type": [
            "integer",
            "string"
          ]
        },
        "query": {
          "type": "object",
          "additionalProperties": true,
          "nullable": true
        },
        "body": {
          "type": "object",
          "additionalProperties": true,
          "nullable": true
        },
        "paginate": {
          "type": "boolean",
          "nullable": true
        },
        "idempotency_key": {
          "type": "string",
          "nullable": true
        }
      },
      "required": [
        "bucket_id",
        "inbox_id"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "api_get_buckets_by_bucket_id_inboxes_by_inbox_id_forwards",
    "method": "GET",
    "path": "/buckets/{bucket_id}/inboxes/{inbox_id}/forwards.json",
    "description": "Raw endpoint wrapper: GET /buckets/{bucket_id}/inboxes/{inbox_id}/forwards.json",
    "inputSchema": {
      "type": "object",
      "properties": {
        "bucket_id": {
          "type": [
            "integer",
            "string"
          ]
        },
        "inbox_id": {
          "type": [
            "integer",
            "string"
          ]
        },
        "query": {
          "type": "object",
          "additionalProperties": true,
          "nullable": true
        },
        "body": {
          "type": "object",
          "additionalProperties": true,
          "nullable": true
        },
        "paginate": {
          "type": "boolean",
          "nullable": true
        },
        "idempotency_key": {
          "type": "string",
          "nullable": true
        }
      },
      "required": [
        "bucket_id",
        "inbox_id"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "api_get_buckets_by_bucket_id_message_boards_by_message_board_id",
    "method": "GET",
    "path": "/buckets/{bucket_id}/message_boards/{message_board_id}.json",
    "description": "Raw endpoint wrapper: GET /buckets/{bucket_id}/message_boards/{message_board_id}.json",
    "inputSchema": {
      "type": "object",
      "properties": {
        "bucket_id": {
          "type": [
            "integer",
            "string"
          ]
        },
        "message_board_id": {
          "type": [
            "integer",
            "string"
          ]
        },
        "query": {
          "type": "object",
          "additionalProperties": true,
          "nullable": true
        },
        "body": {
          "type": "object",
          "additionalProperties": true,
          "nullable": true
        },
        "paginate": {
          "type": "boolean",
          "nullable": true
        },
        "idempotency_key": {
          "type": "string",
          "nullable": true
        }
      },
      "required": [
        "bucket_id",
        "message_board_id"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "api_get_buckets_by_bucket_id_message_boards_by_message_board_id_messages",
    "method": "GET",
    "path": "/buckets/{bucket_id}/message_boards/{message_board_id}/messages.json",
    "description": "Raw endpoint wrapper: GET /buckets/{bucket_id}/message_boards/{message_board_id}/messages.json",
    "inputSchema": {
      "type": "object",
      "properties": {
        "bucket_id": {
          "type": [
            "integer",
            "string"
          ]
        },
        "message_board_id": {
          "type": [
            "integer",
            "string"
          ]
        },
        "query": {
          "type": "object",
          "additionalProperties": true,
          "nullable": true
        },
        "body": {
          "type": "object",
          "additionalProperties": true,
          "nullable": true
        },
        "paginate": {
          "type": "boolean",
          "nullable": true
        },
        "idempotency_key": {
          "type": "string",
          "nullable": true
        }
      },
      "required": [
        "bucket_id",
        "message_board_id"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "api_get_buckets_by_bucket_id_messages_by_message_id",
    "method": "GET",
    "path": "/buckets/{bucket_id}/messages/{message_id}.json",
    "description": "Raw endpoint wrapper: GET /buckets/{bucket_id}/messages/{message_id}.json",
    "inputSchema": {
      "type": "object",
      "properties": {
        "bucket_id": {
          "type": [
            "integer",
            "string"
          ]
        },
        "message_id": {
          "type": [
            "integer",
            "string"
          ]
        },
        "query": {
          "type": "object",
          "additionalProperties": true,
          "nullable": true
        },
        "body": {
          "type": "object",
          "additionalProperties": true,
          "nullable": true
        },
        "paginate": {
          "type": "boolean",
          "nullable": true
        },
        "idempotency_key": {
          "type": "string",
          "nullable": true
        }
      },
      "required": [
        "bucket_id",
        "message_id"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "api_get_buckets_by_bucket_id_question_answers_by_id",
    "method": "GET",
    "path": "/buckets/{bucket_id}/question_answers/{id}.json",
    "description": "Raw endpoint wrapper: GET /buckets/{bucket_id}/question_answers/{id}.json",
    "inputSchema": {
      "type": "object",
      "properties": {
        "bucket_id": {
          "type": [
            "integer",
            "string"
          ]
        },
        "id": {
          "type": [
            "integer",
            "string"
          ]
        },
        "query": {
          "type": "object",
          "additionalProperties": true,
          "nullable": true
        },
        "body": {
          "type": "object",
          "additionalProperties": true,
          "nullable": true
        },
        "paginate": {
          "type": "boolean",
          "nullable": true
        },
        "idempotency_key": {
          "type": "string",
          "nullable": true
        }
      },
      "required": [
        "bucket_id",
        "id"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "api_get_buckets_by_bucket_id_questionnaires_by_questionnaire_id",
    "method": "GET",
    "path": "/buckets/{bucket_id}/questionnaires/{questionnaire_id}.json",
    "description": "Raw endpoint wrapper: GET /buckets/{bucket_id}/questionnaires/{questionnaire_id}.json",
    "inputSchema": {
      "type": "object",
      "properties": {
        "bucket_id": {
          "type": [
            "integer",
            "string"
          ]
        },
        "questionnaire_id": {
          "type": [
            "integer",
            "string"
          ]
        },
        "query": {
          "type": "object",
          "additionalProperties": true,
          "nullable": true
        },
        "body": {
          "type": "object",
          "additionalProperties": true,
          "nullable": true
        },
        "paginate": {
          "type": "boolean",
          "nullable": true
        },
        "idempotency_key": {
          "type": "string",
          "nullable": true
        }
      },
      "required": [
        "bucket_id",
        "questionnaire_id"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "api_get_buckets_by_bucket_id_questionnaires_by_questionnaire_id_questions",
    "method": "GET",
    "path": "/buckets/{bucket_id}/questionnaires/{questionnaire_id}/questions.json",
    "description": "Raw endpoint wrapper: GET /buckets/{bucket_id}/questionnaires/{questionnaire_id}/questions.json",
    "inputSchema": {
      "type": "object",
      "properties": {
        "bucket_id": {
          "type": [
            "integer",
            "string"
          ]
        },
        "questionnaire_id": {
          "type": [
            "integer",
            "string"
          ]
        },
        "query": {
          "type": "object",
          "additionalProperties": true,
          "nullable": true
        },
        "body": {
          "type": "object",
          "additionalProperties": true,
          "nullable": true
        },
        "paginate": {
          "type": "boolean",
          "nullable": true
        },
        "idempotency_key": {
          "type": "string",
          "nullable": true
        }
      },
      "required": [
        "bucket_id",
        "questionnaire_id"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "api_get_buckets_by_bucket_id_questions_by_question_id",
    "method": "GET",
    "path": "/buckets/{bucket_id}/questions/{question_id}.json",
    "description": "Raw endpoint wrapper: GET /buckets/{bucket_id}/questions/{question_id}.json",
    "inputSchema": {
      "type": "object",
      "properties": {
        "bucket_id": {
          "type": [
            "integer",
            "string"
          ]
        },
        "question_id": {
          "type": [
            "integer",
            "string"
          ]
        },
        "query": {
          "type": "object",
          "additionalProperties": true,
          "nullable": true
        },
        "body": {
          "type": "object",
          "additionalProperties": true,
          "nullable": true
        },
        "paginate": {
          "type": "boolean",
          "nullable": true
        },
        "idempotency_key": {
          "type": "string",
          "nullable": true
        }
      },
      "required": [
        "bucket_id",
        "question_id"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "api_get_buckets_by_bucket_id_questions_by_question_id_answers",
    "method": "GET",
    "path": "/buckets/{bucket_id}/questions/{question_id}/answers.json",
    "description": "Raw endpoint wrapper: GET /buckets/{bucket_id}/questions/{question_id}/answers.json",
    "inputSchema": {
      "type": "object",
      "properties": {
        "bucket_id": {
          "type": [
            "integer",
            "string"
          ]
        },
        "question_id": {
          "type": [
            "integer",
            "string"
          ]
        },
        "query": {
          "type": "object",
          "additionalProperties": true,
          "nullable": true
        },
        "body": {
          "type": "object",
          "additionalProperties": true,
          "nullable": true
        },
        "paginate": {
          "type": "boolean",
          "nullable": true
        },
        "idempotency_key": {
          "type": "string",
          "nullable": true
        }
      },
      "required": [
        "bucket_id",
        "question_id"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "api_get_buckets_by_bucket_id_recordings_by_recording_id_comments",
    "method": "GET",
    "path": "/buckets/{bucket_id}/recordings/{recording_id}/comments.json",
    "description": "Raw endpoint wrapper: GET /buckets/{bucket_id}/recordings/{recording_id}/comments.json",
    "inputSchema": {
      "type": "object",
      "properties": {
        "bucket_id": {
          "type": [
            "integer",
            "string"
          ]
        },
        "recording_id": {
          "type": [
            "integer",
            "string"
          ]
        },
        "query": {
          "type": "object",
          "additionalProperties": true,
          "nullable": true
        },
        "body": {
          "type": "object",
          "additionalProperties": true,
          "nullable": true
        },
        "paginate": {
          "type": "boolean",
          "nullable": true
        },
        "idempotency_key": {
          "type": "string",
          "nullable": true
        }
      },
      "required": [
        "bucket_id",
        "recording_id"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "api_get_buckets_by_bucket_id_recordings_by_recording_id_events",
    "method": "GET",
    "path": "/buckets/{bucket_id}/recordings/{recording_id}/events.json",
    "description": "Raw endpoint wrapper: GET /buckets/{bucket_id}/recordings/{recording_id}/events.json",
    "inputSchema": {
      "type": "object",
      "properties": {
        "bucket_id": {
          "type": [
            "integer",
            "string"
          ]
        },
        "recording_id": {
          "type": [
            "integer",
            "string"
          ]
        },
        "query": {
          "type": "object",
          "additionalProperties": true,
          "nullable": true
        },
        "body": {
          "type": "object",
          "additionalProperties": true,
          "nullable": true
        },
        "paginate": {
          "type": "boolean",
          "nullable": true
        },
        "idempotency_key": {
          "type": "string",
          "nullable": true
        }
      },
      "required": [
        "bucket_id",
        "recording_id"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "api_get_buckets_by_bucket_id_recordings_by_recording_id_subscription",
    "method": "GET",
    "path": "/buckets/{bucket_id}/recordings/{recording_id}/subscription.json",
    "description": "Raw endpoint wrapper: GET /buckets/{bucket_id}/recordings/{recording_id}/subscription.json",
    "inputSchema": {
      "type": "object",
      "properties": {
        "bucket_id": {
          "type": [
            "integer",
            "string"
          ]
        },
        "recording_id": {
          "type": [
            "integer",
            "string"
          ]
        },
        "query": {
          "type": "object",
          "additionalProperties": true,
          "nullable": true
        },
        "body": {
          "type": "object",
          "additionalProperties": true,
          "nullable": true
        },
        "paginate": {
          "type": "boolean",
          "nullable": true
        },
        "idempotency_key": {
          "type": "string",
          "nullable": true
        }
      },
      "required": [
        "bucket_id",
        "recording_id"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "api_get_buckets_by_bucket_id_schedule_entries_by_schedule_entry_id",
    "method": "GET",
    "path": "/buckets/{bucket_id}/schedule_entries/{schedule_entry_id}.json",
    "description": "Raw endpoint wrapper: GET /buckets/{bucket_id}/schedule_entries/{schedule_entry_id}.json",
    "inputSchema": {
      "type": "object",
      "properties": {
        "bucket_id": {
          "type": [
            "integer",
            "string"
          ]
        },
        "schedule_entry_id": {
          "type": [
            "integer",
            "string"
          ]
        },
        "query": {
          "type": "object",
          "additionalProperties": true,
          "nullable": true
        },
        "body": {
          "type": "object",
          "additionalProperties": true,
          "nullable": true
        },
        "paginate": {
          "type": "boolean",
          "nullable": true
        },
        "idempotency_key": {
          "type": "string",
          "nullable": true
        }
      },
      "required": [
        "bucket_id",
        "schedule_entry_id"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "api_get_buckets_by_bucket_id_schedules_by_schedule_id",
    "method": "GET",
    "path": "/buckets/{bucket_id}/schedules/{schedule_id}.json",
    "description": "Raw endpoint wrapper: GET /buckets/{bucket_id}/schedules/{schedule_id}.json",
    "inputSchema": {
      "type": "object",
      "properties": {
        "bucket_id": {
          "type": [
            "integer",
            "string"
          ]
        },
        "schedule_id": {
          "type": [
            "integer",
            "string"
          ]
        },
        "query": {
          "type": "object",
          "additionalProperties": true,
          "nullable": true
        },
        "body": {
          "type": "object",
          "additionalProperties": true,
          "nullable": true
        },
        "paginate": {
          "type": "boolean",
          "nullable": true
        },
        "idempotency_key": {
          "type": "string",
          "nullable": true
        }
      },
      "required": [
        "bucket_id",
        "schedule_id"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "api_get_buckets_by_bucket_id_schedules_by_schedule_id_entries",
    "method": "GET",
    "path": "/buckets/{bucket_id}/schedules/{schedule_id}/entries.json",
    "description": "Raw endpoint wrapper: GET /buckets/{bucket_id}/schedules/{schedule_id}/entries.json",
    "inputSchema": {
      "type": "object",
      "properties": {
        "bucket_id": {
          "type": [
            "integer",
            "string"
          ]
        },
        "schedule_id": {
          "type": [
            "integer",
            "string"
          ]
        },
        "query": {
          "type": "object",
          "additionalProperties": true,
          "nullable": true
        },
        "body": {
          "type": "object",
          "additionalProperties": true,
          "nullable": true
        },
        "paginate": {
          "type": "boolean",
          "nullable": true
        },
        "idempotency_key": {
          "type": "string",
          "nullable": true
        }
      },
      "required": [
        "bucket_id",
        "schedule_id"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "api_get_buckets_by_bucket_id_todolists_by_todolist_id",
    "method": "GET",
    "path": "/buckets/{bucket_id}/todolists/{todolist_id}.json",
    "description": "Raw endpoint wrapper: GET /buckets/{bucket_id}/todolists/{todolist_id}.json",
    "inputSchema": {
      "type": "object",
      "properties": {
        "bucket_id": {
          "type": [
            "integer",
            "string"
          ]
        },
        "todolist_id": {
          "type": [
            "integer",
            "string"
          ]
        },
        "query": {
          "type": "object",
          "additionalProperties": true,
          "nullable": true
        },
        "body": {
          "type": "object",
          "additionalProperties": true,
          "nullable": true
        },
        "paginate": {
          "type": "boolean",
          "nullable": true
        },
        "idempotency_key": {
          "type": "string",
          "nullable": true
        }
      },
      "required": [
        "bucket_id",
        "todolist_id"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "api_get_buckets_by_bucket_id_todolists_by_todolist_id_groups",
    "method": "GET",
    "path": "/buckets/{bucket_id}/todolists/{todolist_id}/groups.json",
    "description": "Raw endpoint wrapper: GET /buckets/{bucket_id}/todolists/{todolist_id}/groups.json",
    "inputSchema": {
      "type": "object",
      "properties": {
        "bucket_id": {
          "type": [
            "integer",
            "string"
          ]
        },
        "todolist_id": {
          "type": [
            "integer",
            "string"
          ]
        },
        "query": {
          "type": "object",
          "additionalProperties": true,
          "nullable": true
        },
        "body": {
          "type": "object",
          "additionalProperties": true,
          "nullable": true
        },
        "paginate": {
          "type": "boolean",
          "nullable": true
        },
        "idempotency_key": {
          "type": "string",
          "nullable": true
        }
      },
      "required": [
        "bucket_id",
        "todolist_id"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "api_get_buckets_by_bucket_id_todolists_by_todolist_id_todos",
    "method": "GET",
    "path": "/buckets/{bucket_id}/todolists/{todolist_id}/todos.json",
    "description": "Raw endpoint wrapper: GET /buckets/{bucket_id}/todolists/{todolist_id}/todos.json",
    "inputSchema": {
      "type": "object",
      "properties": {
        "bucket_id": {
          "type": [
            "integer",
            "string"
          ]
        },
        "todolist_id": {
          "type": [
            "integer",
            "string"
          ]
        },
        "query": {
          "type": "object",
          "additionalProperties": true,
          "nullable": true
        },
        "body": {
          "type": "object",
          "additionalProperties": true,
          "nullable": true
        },
        "paginate": {
          "type": "boolean",
          "nullable": true
        },
        "idempotency_key": {
          "type": "string",
          "nullable": true
        }
      },
      "required": [
        "bucket_id",
        "todolist_id"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "api_get_buckets_by_bucket_id_todos_by_todo_id",
    "method": "GET",
    "path": "/buckets/{bucket_id}/todos/{todo_id}.json",
    "description": "Raw endpoint wrapper: GET /buckets/{bucket_id}/todos/{todo_id}.json",
    "inputSchema": {
      "type": "object",
      "properties": {
        "bucket_id": {
          "type": [
            "integer",
            "string"
          ]
        },
        "todo_id": {
          "type": [
            "integer",
            "string"
          ]
        },
        "query": {
          "type": "object",
          "additionalProperties": true,
          "nullable": true
        },
        "body": {
          "type": "object",
          "additionalProperties": true,
          "nullable": true
        },
        "paginate": {
          "type": "boolean",
          "nullable": true
        },
        "idempotency_key": {
          "type": "string",
          "nullable": true
        }
      },
      "required": [
        "bucket_id",
        "todo_id"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "api_get_buckets_by_bucket_id_todosets_by_todoset_id",
    "method": "GET",
    "path": "/buckets/{bucket_id}/todosets/{todoset_id}.json",
    "description": "Raw endpoint wrapper: GET /buckets/{bucket_id}/todosets/{todoset_id}.json",
    "inputSchema": {
      "type": "object",
      "properties": {
        "bucket_id": {
          "type": [
            "integer",
            "string"
          ]
        },
        "todoset_id": {
          "type": [
            "integer",
            "string"
          ]
        },
        "query": {
          "type": "object",
          "additionalProperties": true,
          "nullable": true
        },
        "body": {
          "type": "object",
          "additionalProperties": true,
          "nullable": true
        },
        "paginate": {
          "type": "boolean",
          "nullable": true
        },
        "idempotency_key": {
          "type": "string",
          "nullable": true
        }
      },
      "required": [
        "bucket_id",
        "todoset_id"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "api_get_buckets_by_bucket_id_todosets_by_todoset_id_todolists",
    "method": "GET",
    "path": "/buckets/{bucket_id}/todosets/{todoset_id}/todolists.json",
    "description": "Raw endpoint wrapper: GET /buckets/{bucket_id}/todosets/{todoset_id}/todolists.json",
    "inputSchema": {
      "type": "object",
      "properties": {
        "bucket_id": {
          "type": [
            "integer",
            "string"
          ]
        },
        "todoset_id": {
          "type": [
            "integer",
            "string"
          ]
        },
        "query": {
          "type": "object",
          "additionalProperties": true,
          "nullable": true
        },
        "body": {
          "type": "object",
          "additionalProperties": true,
          "nullable": true
        },
        "paginate": {
          "type": "boolean",
          "nullable": true
        },
        "idempotency_key": {
          "type": "string",
          "nullable": true
        }
      },
      "required": [
        "bucket_id",
        "todoset_id"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "api_get_buckets_by_bucket_id_uploads_by_upload_id",
    "method": "GET",
    "path": "/buckets/{bucket_id}/uploads/{upload_id}.json",
    "description": "Raw endpoint wrapper: GET /buckets/{bucket_id}/uploads/{upload_id}.json",
    "inputSchema": {
      "type": "object",
      "properties": {
        "bucket_id": {
          "type": [
            "integer",
            "string"
          ]
        },
        "upload_id": {
          "type": [
            "integer",
            "string"
          ]
        },
        "query": {
          "type": "object",
          "additionalProperties": true,
          "nullable": true
        },
        "body": {
          "type": "object",
          "additionalProperties": true,
          "nullable": true
        },
        "paginate": {
          "type": "boolean",
          "nullable": true
        },
        "idempotency_key": {
          "type": "string",
          "nullable": true
        }
      },
      "required": [
        "bucket_id",
        "upload_id"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "api_get_buckets_by_bucket_id_vaults_by_vault_id",
    "method": "GET",
    "path": "/buckets/{bucket_id}/vaults/{vault_id}.json",
    "description": "Raw endpoint wrapper: GET /buckets/{bucket_id}/vaults/{vault_id}.json",
    "inputSchema": {
      "type": "object",
      "properties": {
        "bucket_id": {
          "type": [
            "integer",
            "string"
          ]
        },
        "vault_id": {
          "type": [
            "integer",
            "string"
          ]
        },
        "query": {
          "type": "object",
          "additionalProperties": true,
          "nullable": true
        },
        "body": {
          "type": "object",
          "additionalProperties": true,
          "nullable": true
        },
        "paginate": {
          "type": "boolean",
          "nullable": true
        },
        "idempotency_key": {
          "type": "string",
          "nullable": true
        }
      },
      "required": [
        "bucket_id",
        "vault_id"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "api_get_buckets_by_bucket_id_vaults_by_vault_id_documents",
    "method": "GET",
    "path": "/buckets/{bucket_id}/vaults/{vault_id}/documents.json",
    "description": "Raw endpoint wrapper: GET /buckets/{bucket_id}/vaults/{vault_id}/documents.json",
    "inputSchema": {
      "type": "object",
      "properties": {
        "bucket_id": {
          "type": [
            "integer",
            "string"
          ]
        },
        "vault_id": {
          "type": [
            "integer",
            "string"
          ]
        },
        "query": {
          "type": "object",
          "additionalProperties": true,
          "nullable": true
        },
        "body": {
          "type": "object",
          "additionalProperties": true,
          "nullable": true
        },
        "paginate": {
          "type": "boolean",
          "nullable": true
        },
        "idempotency_key": {
          "type": "string",
          "nullable": true
        }
      },
      "required": [
        "bucket_id",
        "vault_id"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "api_get_buckets_by_bucket_id_vaults_by_vault_id_uploads",
    "method": "GET",
    "path": "/buckets/{bucket_id}/vaults/{vault_id}/uploads.json",
    "description": "Raw endpoint wrapper: GET /buckets/{bucket_id}/vaults/{vault_id}/uploads.json",
    "inputSchema": {
      "type": "object",
      "properties": {
        "bucket_id": {
          "type": [
            "integer",
            "string"
          ]
        },
        "vault_id": {
          "type": [
            "integer",
            "string"
          ]
        },
        "query": {
          "type": "object",
          "additionalProperties": true,
          "nullable": true
        },
        "body": {
          "type": "object",
          "additionalProperties": true,
          "nullable": true
        },
        "paginate": {
          "type": "boolean",
          "nullable": true
        },
        "idempotency_key": {
          "type": "string",
          "nullable": true
        }
      },
      "required": [
        "bucket_id",
        "vault_id"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "api_get_buckets_by_bucket_id_vaults_by_vault_id_vaults",
    "method": "GET",
    "path": "/buckets/{bucket_id}/vaults/{vault_id}/vaults.json",
    "description": "Raw endpoint wrapper: GET /buckets/{bucket_id}/vaults/{vault_id}/vaults.json",
    "inputSchema": {
      "type": "object",
      "properties": {
        "bucket_id": {
          "type": [
            "integer",
            "string"
          ]
        },
        "vault_id": {
          "type": [
            "integer",
            "string"
          ]
        },
        "query": {
          "type": "object",
          "additionalProperties": true,
          "nullable": true
        },
        "body": {
          "type": "object",
          "additionalProperties": true,
          "nullable": true
        },
        "paginate": {
          "type": "boolean",
          "nullable": true
        },
        "idempotency_key": {
          "type": "string",
          "nullable": true
        }
      },
      "required": [
        "bucket_id",
        "vault_id"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "api_get_buckets_by_bucket_id_webhooks_by_webhook_id",
    "method": "GET",
    "path": "/buckets/{bucket_id}/webhooks/{webhook_id}.json",
    "description": "Raw endpoint wrapper: GET /buckets/{bucket_id}/webhooks/{webhook_id}.json",
    "inputSchema": {
      "type": "object",
      "properties": {
        "bucket_id": {
          "type": [
            "integer",
            "string"
          ]
        },
        "webhook_id": {
          "type": [
            "integer",
            "string"
          ]
        },
        "query": {
          "type": "object",
          "additionalProperties": true,
          "nullable": true
        },
        "body": {
          "type": "object",
          "additionalProperties": true,
          "nullable": true
        },
        "paginate": {
          "type": "boolean",
          "nullable": true
        },
        "idempotency_key": {
          "type": "string",
          "nullable": true
        }
      },
      "required": [
        "bucket_id",
        "webhook_id"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "api_get_chats",
    "method": "GET",
    "path": "/chats.json",
    "description": "Raw endpoint wrapper: GET /chats.json",
    "inputSchema": {
      "type": "object",
      "properties": {
        "query": {
          "type": "object",
          "additionalProperties": true,
          "nullable": true
        },
        "body": {
          "type": "object",
          "additionalProperties": true,
          "nullable": true
        },
        "paginate": {
          "type": "boolean",
          "nullable": true
        },
        "idempotency_key": {
          "type": "string",
          "nullable": true
        }
      },
      "required": [],
      "additionalProperties": false
    }
  },
  {
    "name": "api_get_my_question_reminders",
    "method": "GET",
    "path": "/my/question_reminders.json",
    "description": "Raw endpoint wrapper: GET /my/question_reminders.json",
    "inputSchema": {
      "type": "object",
      "properties": {
        "query": {
          "type": "object",
          "additionalProperties": true,
          "nullable": true
        },
        "body": {
          "type": "object",
          "additionalProperties": true,
          "nullable": true
        },
        "paginate": {
          "type": "boolean",
          "nullable": true
        },
        "idempotency_key": {
          "type": "string",
          "nullable": true
        }
      },
      "required": [],
      "additionalProperties": false
    }
  },
  {
    "name": "api_get_people",
    "method": "GET",
    "path": "/people.json",
    "description": "Raw endpoint wrapper: GET /people.json",
    "inputSchema": {
      "type": "object",
      "properties": {
        "query": {
          "type": "object",
          "additionalProperties": true,
          "nullable": true
        },
        "body": {
          "type": "object",
          "additionalProperties": true,
          "nullable": true
        },
        "paginate": {
          "type": "boolean",
          "nullable": true
        },
        "idempotency_key": {
          "type": "string",
          "nullable": true
        }
      },
      "required": [],
      "additionalProperties": false
    }
  },
  {
    "name": "api_get_people_by_person_id",
    "method": "GET",
    "path": "/people/{person_id}.json",
    "description": "Raw endpoint wrapper: GET /people/{person_id}.json",
    "inputSchema": {
      "type": "object",
      "properties": {
        "person_id": {
          "type": [
            "integer",
            "string"
          ]
        },
        "query": {
          "type": "object",
          "additionalProperties": true,
          "nullable": true
        },
        "body": {
          "type": "object",
          "additionalProperties": true,
          "nullable": true
        },
        "paginate": {
          "type": "boolean",
          "nullable": true
        },
        "idempotency_key": {
          "type": "string",
          "nullable": true
        }
      },
      "required": [
        "person_id"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "api_get_projects",
    "method": "GET",
    "path": "/projects.json",
    "description": "Raw endpoint wrapper: GET /projects.json",
    "inputSchema": {
      "type": "object",
      "properties": {
        "query": {
          "type": "object",
          "additionalProperties": true,
          "nullable": true
        },
        "body": {
          "type": "object",
          "additionalProperties": true,
          "nullable": true
        },
        "paginate": {
          "type": "boolean",
          "nullable": true
        },
        "idempotency_key": {
          "type": "string",
          "nullable": true
        }
      },
      "required": [],
      "additionalProperties": false
    }
  },
  {
    "name": "api_get_projects_by_project_id",
    "method": "GET",
    "path": "/projects/{project_id}.json",
    "description": "Raw endpoint wrapper: GET /projects/{project_id}.json",
    "inputSchema": {
      "type": "object",
      "properties": {
        "project_id": {
          "type": [
            "integer",
            "string"
          ]
        },
        "query": {
          "type": "object",
          "additionalProperties": true,
          "nullable": true
        },
        "body": {
          "type": "object",
          "additionalProperties": true,
          "nullable": true
        },
        "paginate": {
          "type": "boolean",
          "nullable": true
        },
        "idempotency_key": {
          "type": "string",
          "nullable": true
        }
      },
      "required": [
        "project_id"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "api_get_projects_by_project_id_recordings_by_recording_id_timesheet",
    "method": "GET",
    "path": "/projects/{project_id}/recordings/{recording_id}/timesheet.json",
    "description": "Raw endpoint wrapper: GET /projects/{project_id}/recordings/{recording_id}/timesheet.json",
    "inputSchema": {
      "type": "object",
      "properties": {
        "project_id": {
          "type": [
            "integer",
            "string"
          ]
        },
        "recording_id": {
          "type": [
            "integer",
            "string"
          ]
        },
        "query": {
          "type": "object",
          "additionalProperties": true,
          "nullable": true
        },
        "body": {
          "type": "object",
          "additionalProperties": true,
          "nullable": true
        },
        "paginate": {
          "type": "boolean",
          "nullable": true
        },
        "idempotency_key": {
          "type": "string",
          "nullable": true
        }
      },
      "required": [
        "project_id",
        "recording_id"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "api_get_projects_by_project_id_timeline",
    "method": "GET",
    "path": "/projects/{project_id}/timeline.json",
    "description": "Raw endpoint wrapper: GET /projects/{project_id}/timeline.json",
    "inputSchema": {
      "type": "object",
      "properties": {
        "project_id": {
          "type": [
            "integer",
            "string"
          ]
        },
        "query": {
          "type": "object",
          "additionalProperties": true,
          "nullable": true
        },
        "body": {
          "type": "object",
          "additionalProperties": true,
          "nullable": true
        },
        "paginate": {
          "type": "boolean",
          "nullable": true
        },
        "idempotency_key": {
          "type": "string",
          "nullable": true
        }
      },
      "required": [
        "project_id"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "api_get_projects_by_project_id_timesheet",
    "method": "GET",
    "path": "/projects/{project_id}/timesheet.json",
    "description": "Raw endpoint wrapper: GET /projects/{project_id}/timesheet.json",
    "inputSchema": {
      "type": "object",
      "properties": {
        "project_id": {
          "type": [
            "integer",
            "string"
          ]
        },
        "query": {
          "type": "object",
          "additionalProperties": true,
          "nullable": true
        },
        "body": {
          "type": "object",
          "additionalProperties": true,
          "nullable": true
        },
        "paginate": {
          "type": "boolean",
          "nullable": true
        },
        "idempotency_key": {
          "type": "string",
          "nullable": true
        }
      },
      "required": [
        "project_id"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "api_get_reports_progress",
    "method": "GET",
    "path": "/reports/progress.json",
    "description": "Raw endpoint wrapper: GET /reports/progress.json",
    "inputSchema": {
      "type": "object",
      "properties": {
        "query": {
          "type": "object",
          "additionalProperties": true,
          "nullable": true
        },
        "body": {
          "type": "object",
          "additionalProperties": true,
          "nullable": true
        },
        "paginate": {
          "type": "boolean",
          "nullable": true
        },
        "idempotency_key": {
          "type": "string",
          "nullable": true
        }
      },
      "required": [],
      "additionalProperties": false
    }
  },
  {
    "name": "api_get_reports_schedules_upcoming",
    "method": "GET",
    "path": "/reports/schedules/upcoming.json",
    "description": "Raw endpoint wrapper: GET /reports/schedules/upcoming.json",
    "inputSchema": {
      "type": "object",
      "properties": {
        "query": {
          "type": "object",
          "additionalProperties": true,
          "nullable": true
        },
        "body": {
          "type": "object",
          "additionalProperties": true,
          "nullable": true
        },
        "paginate": {
          "type": "boolean",
          "nullable": true
        },
        "idempotency_key": {
          "type": "string",
          "nullable": true
        }
      },
      "required": [],
      "additionalProperties": false
    }
  },
  {
    "name": "api_get_reports_timesheet",
    "method": "GET",
    "path": "/reports/timesheet.json",
    "description": "Raw endpoint wrapper: GET /reports/timesheet.json",
    "inputSchema": {
      "type": "object",
      "properties": {
        "query": {
          "type": "object",
          "additionalProperties": true,
          "nullable": true
        },
        "body": {
          "type": "object",
          "additionalProperties": true,
          "nullable": true
        },
        "paginate": {
          "type": "boolean",
          "nullable": true
        },
        "idempotency_key": {
          "type": "string",
          "nullable": true
        }
      },
      "required": [],
      "additionalProperties": false
    }
  },
  {
    "name": "api_get_reports_todos_assigned",
    "method": "GET",
    "path": "/reports/todos/assigned.json",
    "description": "Raw endpoint wrapper: GET /reports/todos/assigned.json",
    "inputSchema": {
      "type": "object",
      "properties": {
        "query": {
          "type": "object",
          "additionalProperties": true,
          "nullable": true
        },
        "body": {
          "type": "object",
          "additionalProperties": true,
          "nullable": true
        },
        "paginate": {
          "type": "boolean",
          "nullable": true
        },
        "idempotency_key": {
          "type": "string",
          "nullable": true
        }
      },
      "required": [],
      "additionalProperties": false
    }
  },
  {
    "name": "api_get_reports_todos_assigned_by_id",
    "method": "GET",
    "path": "/reports/todos/assigned/{id}.json",
    "description": "Raw endpoint wrapper: GET /reports/todos/assigned/{id}.json",
    "inputSchema": {
      "type": "object",
      "properties": {
        "id": {
          "type": [
            "integer",
            "string"
          ]
        },
        "query": {
          "type": "object",
          "additionalProperties": true,
          "nullable": true
        },
        "body": {
          "type": "object",
          "additionalProperties": true,
          "nullable": true
        },
        "paginate": {
          "type": "boolean",
          "nullable": true
        },
        "idempotency_key": {
          "type": "string",
          "nullable": true
        }
      },
      "required": [
        "id"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "api_get_reports_todos_overdue",
    "method": "GET",
    "path": "/reports/todos/overdue.json",
    "description": "Raw endpoint wrapper: GET /reports/todos/overdue.json",
    "inputSchema": {
      "type": "object",
      "properties": {
        "query": {
          "type": "object",
          "additionalProperties": true,
          "nullable": true
        },
        "body": {
          "type": "object",
          "additionalProperties": true,
          "nullable": true
        },
        "paginate": {
          "type": "boolean",
          "nullable": true
        },
        "idempotency_key": {
          "type": "string",
          "nullable": true
        }
      },
      "required": [],
      "additionalProperties": false
    }
  },
  {
    "name": "api_get_reports_users_progress_by_id",
    "method": "GET",
    "path": "/reports/users/progress/{id}.json",
    "description": "Raw endpoint wrapper: GET /reports/users/progress/{id}.json",
    "inputSchema": {
      "type": "object",
      "properties": {
        "id": {
          "type": [
            "integer",
            "string"
          ]
        },
        "query": {
          "type": "object",
          "additionalProperties": true,
          "nullable": true
        },
        "body": {
          "type": "object",
          "additionalProperties": true,
          "nullable": true
        },
        "paginate": {
          "type": "boolean",
          "nullable": true
        },
        "idempotency_key": {
          "type": "string",
          "nullable": true
        }
      },
      "required": [
        "id"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "api_get_templates",
    "method": "GET",
    "path": "/templates.json",
    "description": "Raw endpoint wrapper: GET /templates.json",
    "inputSchema": {
      "type": "object",
      "properties": {
        "query": {
          "type": "object",
          "additionalProperties": true,
          "nullable": true
        },
        "body": {
          "type": "object",
          "additionalProperties": true,
          "nullable": true
        },
        "paginate": {
          "type": "boolean",
          "nullable": true
        },
        "idempotency_key": {
          "type": "string",
          "nullable": true
        }
      },
      "required": [],
      "additionalProperties": false
    }
  },
  {
    "name": "api_get_templates_by_template_id",
    "method": "GET",
    "path": "/templates/{template_id}.json",
    "description": "Raw endpoint wrapper: GET /templates/{template_id}.json",
    "inputSchema": {
      "type": "object",
      "properties": {
        "template_id": {
          "type": [
            "integer",
            "string"
          ]
        },
        "query": {
          "type": "object",
          "additionalProperties": true,
          "nullable": true
        },
        "body": {
          "type": "object",
          "additionalProperties": true,
          "nullable": true
        },
        "paginate": {
          "type": "boolean",
          "nullable": true
        },
        "idempotency_key": {
          "type": "string",
          "nullable": true
        }
      },
      "required": [
        "template_id"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "api_get_templates_by_template_id_project_constructions_by_id",
    "method": "GET",
    "path": "/templates/{template_id}/project_constructions/{id}.json",
    "description": "Raw endpoint wrapper: GET /templates/{template_id}/project_constructions/{id}.json",
    "inputSchema": {
      "type": "object",
      "properties": {
        "template_id": {
          "type": [
            "integer",
            "string"
          ]
        },
        "id": {
          "type": [
            "integer",
            "string"
          ]
        },
        "query": {
          "type": "object",
          "additionalProperties": true,
          "nullable": true
        },
        "body": {
          "type": "object",
          "additionalProperties": true,
          "nullable": true
        },
        "paginate": {
          "type": "boolean",
          "nullable": true
        },
        "idempotency_key": {
          "type": "string",
          "nullable": true
        }
      },
      "required": [
        "template_id",
        "id"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "api_post_templates_by_template_id_project_constructions",
    "method": "POST",
    "path": "/templates/{template_id}/project_constructions.json",
    "description": "Raw endpoint wrapper: POST /templates/{template_id}/project_constructions.json",
    "inputSchema": {
      "type": "object",
      "properties": {
        "template_id": {
          "type": [
            "integer",
            "string"
          ]
        },
        "query": {
          "type": "object",
          "additionalProperties": true,
          "nullable": true
        },
        "body": {
          "type": "object",
          "additionalProperties": true,
          "nullable": true
        },
        "paginate": {
          "type": "boolean",
          "nullable": true
        },
        "idempotency_key": {
          "type": "string",
          "nullable": true
        }
      },
      "required": [
        "template_id"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "api_put_buckets_by_bucket_id_recordings_by_recording_id_subscription",
    "method": "PUT",
    "path": "/buckets/{bucket_id}/recordings/{recording_id}/subscription.json",
    "description": "Raw endpoint wrapper: PUT /buckets/{bucket_id}/recordings/{recording_id}/subscription.json",
    "inputSchema": {
      "type": "object",
      "properties": {
        "bucket_id": {
          "type": [
            "integer",
            "string"
          ]
        },
        "recording_id": {
          "type": [
            "integer",
            "string"
          ]
        },
        "query": {
          "type": "object",
          "additionalProperties": true,
          "nullable": true
        },
        "body": {
          "type": "object",
          "additionalProperties": true,
          "nullable": true
        },
        "paginate": {
          "type": "boolean",
          "nullable": true
        },
        "idempotency_key": {
          "type": "string",
          "nullable": true
        }
      },
      "required": [
        "bucket_id",
        "recording_id"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "api_put_projects_by_project_id_people_users",
    "method": "PUT",
    "path": "/projects/{project_id}/people/users.json",
    "description": "Raw endpoint wrapper: PUT /projects/{project_id}/people/users.json",
    "inputSchema": {
      "type": "object",
      "properties": {
        "project_id": {
          "type": [
            "integer",
            "string"
          ]
        },
        "query": {
          "type": "object",
          "additionalProperties": true,
          "nullable": true
        },
        "body": {
          "type": "object",
          "additionalProperties": true,
          "nullable": true
        },
        "paginate": {
          "type": "boolean",
          "nullable": true
        },
        "idempotency_key": {
          "type": "string",
          "nullable": true
        }
      },
      "required": [
        "project_id"
      ],
      "additionalProperties": false
    }
  }
];

export const ENDPOINT_TOOL_MAP = new Map(ENDPOINT_TOOLS.map(t => [t.name, t]));
