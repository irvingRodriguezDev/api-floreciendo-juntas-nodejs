{
  "family": "floreciendo-task",
  "networkMode": "awsvpc",
  "executionRoleArn": "arn:aws:iam::693148193622:role/ecsTaskExecutionRole",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "2048",
  "memory": "4096",
  "runtimePlatform": {
    "cpuArchitecture": "X86_64",
    "operatingSystemFamily": "LINUX"
  },
  "containerDefinitions": [
    {
      "name": "api-container",
      "image": "693148193622.dkr.ecr.us-east-2.amazonaws.com/api/floreciendo-juntas:latest",
      "essential": true,
      "portMappings": [
        {
          "containerPort": 3000,
          "protocol": "tcp"
        }
      ],
      "secrets": [
        {
          "name": "DB_NAME",
          "valueFrom": "arn:aws:secretsmanager:us-east-2:693148193622:secret:floreciendo/api-secrets-db-name-UHpoZX:DB_NAME::"
        },
        {
          "name": "DB_HOST",
          "valueFrom": "arn:aws:secretsmanager:us-east-2:693148193622:secret:floreciendo/api-secrets-db-host-LmK4Ed:DB_HOST::"
        },
        {
          "name": "DB_USER",
          "valueFrom": "arn:aws:secretsmanager:us-east-2:693148193622:secret:floreciendo/api-secrets-db-user-htiEQt:DB_USER::"
        },
        {
          "name": "DB_PASSWORD",
          "valueFrom": "arn:aws:secretsmanager:us-east-2:693148193622:secret:floreciendo/api-secrets-db-password-z0hmWM:DB_PASSWORD::"
        },
        {
          "name": "DB_PORT",
          "valueFrom": "arn:aws:secretsmanager:us-east-2:693148193622:secret:floreciendo/api-secrets-db-port-zVyhto:DB_PORT::"
        },
        {
          "name": "STRIPE_SECRET_KEY",
          "valueFrom": "arn:aws:secretsmanager:us-east-2:693148193622:secret:floreciendo/api-secrets-strpe-secret-RInytM:STRIPE_SECRET_KEY::"
        },
        {
          "name": "STRIPE_PUBLIC_KEY",
          "valueFrom": "arn:aws:secretsmanager:us-east-2:693148193622:secret:floreciendo/api-secrets-stripe-public-LJuVYl:STRIPE_PUBLIC_KEY::"
        },
        {
          "name": "STRIPE_PRICE_ONETIME",
          "valueFrom": "arn:aws:secretsmanager:us-east-2:693148193622:secret:floreciendo/api-secrets-stripe-price-onetime-mIW9wk:STRIPE_PRICE_ONETIME::"
        },
        {
          "name": "STRIPE_PRICE_RECURRING",
          "valueFrom": "arn:aws:secretsmanager:us-east-2:693148193622:secret:floreciendo/api-secrets-stripe-price-recurring-SUkPL7:STRIPE_PRICE_RECURRING::"
        },
        {
          "name": "STRIPE_WEBHOOK_SUBSCRIPTION_SECRET",
          "valueFrom": "arn:aws:secretsmanager:us-east-2:693148193622:secret:floreciendo/api-secrets-stripe-webhook-subscription-qUgJuJ:STRIPE_WEBHOOK_SUBSCRIPTION_SECRET::"
        },
        {
          "name": "STRIPE_WEBHOOK_TICKET_SECRET",
          "valueFrom": "arn:aws:secretsmanager:us-east-2:693148193622:secret:floreciendo/api-secrets-stripe-webhook-ticket-2kUTQC:STRIPE_WEBHOOK_TICKET_SECRET::"
        },
        {
          "name": "SENDGRID_API_KEY",
          "valueFrom": "arn:aws:secretsmanager:us-east-2:693148193622:secret:floreciendo/api-secrets-sendgrid-api-key-vqdKWi:SENDGRID_API_KEY::"
        },
        {
          "name": "SENGRID_FROM",
          "valueFrom": "arn:aws:secretsmanager:us-east-2:693148193622:secret:floreciendo/api-secrets-sendgrid-from-PuzcMi:SENGRID_FROM::"
        },
        {
          "name": "CLIENT_URL",
          "valueFrom": "arn:aws:secretsmanager:us-east-2:693148193622:secret:floreciendo/api-secrets-client-url-zUSS38:CLIENT_URL::"
        },
        {
          "name": "BACKEND_URL",
          "valueFrom": "arn:aws:secretsmanager:us-east-2:693148193622:secret:floreciendo/api-secrets-backend-url-RIlV4W:BACKEND_URL::"
        },
        {
            "name":"JWT_SECRET",
            "valueFrom": "arn:aws:secretsmanager:us-east-2:693148193622:secret:floreciendo/api-secrets-jwt-secret-Vo49MW:JWT_SECRET::"
        },
        { 
            "name":"AWS_REGION",
            "valueFrom":"arn:aws:secretsmanager:us-east-2:693148193622:secret:floreciendo/api-secrets-aws-region-hhX5vn:AWS_REGION::"
        },
        {
            "name":"AWS_ACCESS_KEY_ID",
            "valueFrom":"arn:aws:secretsmanager:us-east-2:693148193622:secret:floreciendo/api-secrets-key-id-aws-2qJpYa:AWS_ACCESS_KEY_ID::"
        },
        {
            "name":"AWS_SECRET_ACCESS_KEY",
            "valueFrom":"arn:aws:secretsmanager:us-east-2:693148193622:secret:floreciendo/api-secrets-aws-key-secret-qzt7i8:AWS_SECRET_ACCESS_KEY::"
        },
        {
            "name":"AWS_BUCKET_NAME",
            "valueFrom":"arn:aws:secretsmanager:us-east-2:693148193622:secret:floreciendo/api-secrets-bucket-name-qw93Ri:AWS_BUCKET_NAME::"
        },
        {
            "name":"AWS_S3_ENVIRONMENT",
            "valueFrom":"arn:aws:secretsmanager:us-east-2:693148193622:secret:floreciendo/api-secrets-aws-s3-env-fUgdBe:AWS_S3_ENVIRONMENT::"
        }
      ],
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/floreciendo-task",
          "awslogs-region": "us-east-2",
          "awslogs-stream-prefix": "ecs"
        }
      }
    }
  ]
}
