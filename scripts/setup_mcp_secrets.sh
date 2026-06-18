#!/bin/bash
while IFS='=' read -r key value; do
  if [[ ! -z "$key" && "$key" != \#* ]]; then
    # Remove quotes
    val=$(echo "$value" | sed -e "s/^'//" -e "s/'$//" -e 's/^"//' -e 's/"$//')
    declare "$key=$val"
  fi
done < .env

if [ -n "$ATLASSIAN_API_TOKEN" ]; then
  docker mcp secret set atlassian.jira.api_token "$ATLASSIAN_API_TOKEN"
  docker mcp secret set atlassian.confluence.api_token "$ATLASSIAN_API_TOKEN"
fi

if [ -n "$ATLASSIAN_EMAIL" ]; then
  echo "Email: $ATLASSIAN_EMAIL"
fi
if [ -n "$ATLASSIAN_URL" ]; then
  echo "URL: $ATLASSIAN_URL"
fi
