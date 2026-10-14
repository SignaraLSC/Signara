"""Motor preparado en RAM, sin captura hasta recibir START de la ventana."""
from dataclasses import dataclass
import threading


@dataclass
class CaptureSession:
    id: int
    stop: threading.Event
    pending: object
    ledger: object
    recorder: object = None
    identity: int = 0


class ResidentAudio:
    def __init__(self, capture, queue_factory, ledger_factory, emit, close_timeout=3):
        self.capture = capture
        self.queue_factory, self.ledger_factory = queue_factory, ledger_factory
        self.emit = emit
        self.close_timeout = close_timeout
        self.operations = threading.RLock()
        self.lock = threading.RLock()
        self.changed = threading.Event()
        self.closed = threading.Event()
        self.prepared = False
        self.desired = None
        self.last_id = 0
        self.active = None

    def _pause(self):
        with self.lock:
            previous, self.active = self.active, None
            if previous: previous.stop.set()
        if previous:
            previous.recorder.join(self.close_timeout)
            if previous.recorder.is_alive():
                raise RuntimeError('La captura no terminó de cerrar. Vuelve a activar play.')

    def _start(self, identity):
        self._pause()
        session = CaptureSession(identity, threading.Event(), self.queue_factory(), self.ledger_factory())

        def publish(kind, **payload):
            with self.lock:
                if self.active is session and not session.stop.is_set():
                    self.emit(kind, session=session.id, **payload)

        session.recorder = threading.Thread(target=self.capture,
            args=(session.stop, session.pending, publish), daemon=True)
        with self.lock: self.active = session
        session.recorder.start()
        self.changed.set()

    def request(self, action, identity):
        if action not in ('start', 'pause') or type(identity) is not int or identity <= 0:
            raise ValueError('Comando de audio inválido.')
        with self.operations:
            if self.closed.is_set() or identity < self.last_id: return
            if action == 'start':
                # Una sesión se inicia una sola vez, incluso con un reenvío IPC.
                if identity == self.last_id: return
                self.last_id = identity
                self.desired = identity
                if self.prepared: self._start(identity)
            else:
                if identity != self.last_id: return
                self.desired = None
                self._pause()
                # El acuse solo llega después de cerrar el dispositivo.
                self.emit('status', session=identity, state='paused')

    def mark_prepared(self):
        with self.operations:
            self.prepared = True
            self.emit('status', session=0, state='prepared')
            if self.desired is not None: self._start(self.desired)

    def current(self):
        with self.lock: return self.active

    def deliver(self, session, text, snapshot):
        with self.lock:
            if self.active is not session or session.stop.is_set() or not text: return
            session.identity += 1
            self.emit('transcript', session=session.id, id=session.identity, text=text, final=True,
                start=snapshot.start, end=snapshot.end, boundary=snapshot.boundary)

    def close(self):
        with self.operations:
            self.closed.set()
            self.desired = None
            self._pause()
            self.changed.set()


def read_commands(receive, closed):
    """Leer bytes disponibles; nunca bloquear sys.stdin durante imports nativos."""
    import ctypes
    import json
    import msvcrt
    import os
    import sys
    from ctypes import wintypes
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    kernel.PeekNamedPipe.argtypes = (wintypes.HANDLE, wintypes.LPVOID, wintypes.DWORD,
        ctypes.POINTER(wintypes.DWORD), ctypes.POINTER(wintypes.DWORD), ctypes.POINTER(wintypes.DWORD))
    kernel.PeekNamedPipe.restype = wintypes.BOOL
    pipe = msvcrt.get_osfhandle(sys.stdin.fileno())
    pending = b''
    while not closed.is_set():
        available = wintypes.DWORD()
        if not kernel.PeekNamedPipe(pipe, None, 0, None, ctypes.byref(available), None): return
        if not available.value:
            closed.wait(0.025)
            continue
        pending += os.read(sys.stdin.fileno(), min(available.value, 4096))
        if len(pending) > 65536: raise ValueError('Comando de audio demasiado grande.')
        while b'\n' in pending:
            line, pending = pending.split(b'\n', 1)
            command = json.loads(line)
            receive(command.get('action'), command.get('session'))
