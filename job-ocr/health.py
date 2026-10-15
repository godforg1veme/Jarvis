import socket

try:
    with socket.socket(socket.AF_UNIX) as connection:
        connection.settimeout(3)
        connection.connect('/run/job-ocr/ocr.sock')
        connection.sendall(b'GET /health HTTP/1.0\r\nHost: localhost\r\n\r\n')
        if b' 200 ' not in connection.recv(128).split(b'\r\n', 1)[0]:
            raise ValueError()
except Exception:
    raise SystemExit(1)
