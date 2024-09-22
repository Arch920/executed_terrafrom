provider "aws" {
  region = var.aws_region
}

provider "archive" {}

data "archive_file" "zip" {
  type        = "zip"
  source_file = "index.js"
  output_path = "index.zip"
}

data "aws_iam_policy_document" "lambda_cw_assume_role_policy" {
  statement {
    effect = "Allow"
    principals {
      identifiers = ["lambda.amazonaws.com"]
      type        = "Service"
    }
    actions = ["sts:AssumeRole"]
  }
}

resource "aws_iam_role" "iam_for_lambda_cw_role_tf" {
  name               = "iam_for_lambda_cw_role_tf"
  assume_role_policy = data.aws_iam_policy_document.lambda_cw_assume_role_policy.json
  tags = {
    Name = "iam_for_lambda_cw_role_tf"
  }
}

resource "aws_iam_role_policy" "lambda_logging_policy" {
  name   = "lambda_logging_policy"
  role   = aws_iam_role.iam_for_lambda_cw_role_tf.id
  policy = jsonencode({
    Version = "2012-10-17",
    Statement = [
      {
        Effect    = "Allow",
        Action    = [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents",
        ],
        Resource  = "*"
      }
    ]
  })
}

resource "aws_cloudwatch_log_group" "urlCheckerLambdaTF" {
  name              = "/aws/lambda/urlCheckerLambdaTF" # Use a static name to avoid cycles
  retention_in_days = 60
  tags = {
    Name = "urlCheckerLambdaTFLogs"
  }
}

resource "aws_lambda_function" "lambda" {
  function_name    = "urlCheckerLambdaTF"
  description      = "Lambda to check URL status deployed via terraform"
  filename         = data.archive_file.zip.output_path
  source_code_hash = data.archive_file.zip.output_base64sha256
  role             = aws_iam_role.iam_for_lambda_cw_role_tf.arn
  handler          = "index.handler"
  runtime          = "nodejs18.x"
  architectures    = ["arm64"]
  timeout          = 30

  environment {
    variables = {
      WEBSITE_URLS = "bit.ly/smartphonewp,bit.ly/arckportfolio,bit.ly/lexbankbot"
    }
  }

  tags = {
    Name = "urlCheckerLambdaTF"
  }

  depends_on = [
    aws_iam_role_policy.lambda_logging_policy,
    aws_cloudwatch_log_group.urlCheckerLambdaTF,
  ]
}

resource "aws_cloudwatch_event_rule" "daily_trigger_rule" {
  name                = "daily-trigger-rule"
  description         = "Triggers the Lambda function daily at 15:45 UTC"
  schedule_expression  = "cron(48 15 * * ? *)" 
}

resource "aws_cloudwatch_event_target" "lambda_target" {
  rule      = aws_cloudwatch_event_rule.daily_trigger_rule.name
  arn       = aws_lambda_function.lambda.arn
}

resource "aws_lambda_permission" "allow_eventbridge_to_invoke_lambda" {
  statement_id   = "AllowExecutionFromEventBridge"
  action         = "lambda:InvokeFunction"
  function_name  = aws_lambda_function.lambda.function_name
  principal      = "events.amazonaws.com"
  
  # Reference the ARN of the EventBridge rule to restrict invocation permissions
  source_arn     = aws_cloudwatch_event_rule.daily_trigger_rule.arn
}