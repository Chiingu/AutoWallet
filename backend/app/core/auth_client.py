import httpx
from fastapi import HTTPException, Request, status

AUTHORIZATION_URL = "http://api-gateway:3000/api/authorize"


async def require_client(request: Request):
    token = request.headers.get("Authorization")

    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing authentication token",
        )

    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            response = await client.post(
                AUTHORIZATION_URL,
                headers={
                    "Authorization": token,
                },
                json={
                    "permission": "client:access",
                },
            )

    except httpx.RequestError:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Authorization service unavailable",
        )

    if response.status_code == 401:
        raise HTTPException(
            status_code=401,
            detail="Invalid or expired token",
        )

    if response.status_code == 403:
        raise HTTPException(
            status_code=403,
            detail="Client access forbidden",
        )

    if response.status_code != 200:
        raise HTTPException(
            status_code=503,
            detail="Authorization service error",
        )

    return response.json()