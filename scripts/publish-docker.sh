#!/bin/bash
# Script to publish Docker images to a registry

set -e

# Configuration
IMAGE_NAME=${1:-"overlord-server"}
REGISTRY=${2:-"ghcr.io"}
USERNAME=${3:-$USER}
VERSION=${4:-"latest"}

FULL_IMAGE="${REGISTRY}/${USERNAME}/${IMAGE_NAME}:${VERSION}"

echo "Building and pushing: ${FULL_IMAGE}"

# Build for multiple platforms
docker buildx create --use --name overlord-builder 2>/dev/null || docker buildx use overlord-builder

# Build and push server
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  -t "${FULL_IMAGE}" \
  -t "${REGISTRY}/${USERNAME}/${IMAGE_NAME}:latest" \
  --push \
  -f Dockerfile \
  .

echo "✅ Successfully published ${FULL_IMAGE}"
echo ""
echo "Users can now run:"
echo "  docker run -d -p 5173:5173 -e OVERLORD_USER=admin -e OVERLORD_PASS=admin ${FULL_IMAGE}"
