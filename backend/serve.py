"""Production-style runner for the flood Flask backend.

Use this for demo/remote deployment instead of Flask's built-in development server:

    python serve.py

Optional environment variables:
    HOST=0.0.0.0
    PORT=5000
    WAITRESS_THREADS=8
"""

import os

from waitress import serve

from app import app


if __name__ == "__main__":
    host = os.environ.get("HOST", "0.0.0.0")
    port = int(os.environ.get("PORT", "5000"))
    threads = int(os.environ.get("WAITRESS_THREADS", "8"))
    print(f"Starting flood backend with Waitress on http://{host}:{port} (threads={threads})")
    serve(app, host=host, port=port, threads=threads)
