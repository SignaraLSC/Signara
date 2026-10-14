import queue
import threading
import unittest
from types import SimpleNamespace
from resident import ResidentAudio


class ResidentTests(unittest.TestCase):
    def setUp(self):
        self.events = []
        self.opened = []
        self.closed_devices = []
        self.listening = threading.Event()

        def capture(stop, pending, publish):
            self.opened.append(pending)
            publish('status', state='listening')
            self.listening.set()
            stop.wait()
            self.closed_devices.append(pending)
            publish('transcript', id=99, text='resultado viejo', final=True)

        self.engine = ResidentAudio(capture, queue.Queue, object,
            lambda kind, **data: self.events.append({'type': kind, **data}))

    def tearDown(self): self.engine.close()

    def ready(self):
        self.assertTrue(self.listening.wait(1))
        self.listening.clear()

    def test_preparation_does_not_open_audio_or_mark_listening(self):
        self.engine.mark_prepared()
        self.assertEqual(self.opened, [])
        self.assertIsNone(self.engine.current())
        self.assertEqual(self.events, [{'type': 'status', 'session': 0, 'state': 'prepared'}])

    def test_pause_closes_audio_but_keeps_prepared_model_and_restarts_clean(self):
        self.engine.mark_prepared()
        self.engine.request('start', 1)
        self.ready()
        old = self.engine.current()
        self.engine.request('pause', 1)
        self.assertTrue(self.engine.prepared)
        self.assertIsNone(self.engine.current())
        self.assertEqual(self.closed_devices, self.opened)
        self.assertEqual(self.events[-1]['state'], 'paused')
        snapshot = SimpleNamespace(start=0, end=1, boundary='pause')
        self.engine.deliver(old, 'audio que terminó después de pausar', snapshot)
        self.assertFalse(any(event['type'] == 'transcript' for event in self.events))
        self.engine.request('start', 2)
        self.ready()
        new = self.engine.current()
        self.assertIsNot(new.pending, old.pending)
        self.assertIsNot(new.ledger, old.ledger)
        self.engine.deliver(new, 'tengo sed', snapshot)
        self.assertEqual(self.events[-1]['session'], 2)
        self.assertEqual(self.events[-1]['id'], 1)

    def test_cancel_during_model_loading_never_starts_capture(self):
        self.engine.request('start', 1)
        self.engine.request('pause', 1)
        self.engine.mark_prepared()
        self.assertEqual(self.opened, [])
        self.assertIsNone(self.engine.current())

    def test_start_during_preparation_waits_until_ready(self):
        self.engine.request('start', 1)
        self.assertEqual(self.opened, [])
        self.engine.mark_prepared()
        self.ready()
        self.assertEqual(len(self.opened), 1)

    def test_old_or_repeated_commands_cannot_restart_or_pause_new_capture(self):
        self.engine.mark_prepared()
        self.engine.request('start', 1)
        self.ready()
        self.engine.request('start', 1)
        self.assertEqual(len(self.opened), 1)
        self.engine.request('start', 2)
        self.ready()
        self.engine.request('pause', 1)
        self.engine.request('start', 1)
        self.assertEqual(self.engine.current().id, 2)
        self.assertEqual(len(self.opened), 2)

    def test_closed_widget_cannot_activate_capture(self):
        self.engine.close()
        self.engine.request('start', 1)
        self.engine.mark_prepared()
        self.assertEqual(self.opened, [])

    def test_invalid_commands_are_rejected(self):
        for action, identity in [('start', 0), ('start', True), ('start', '1'), ('listen', 1)]:
            with self.assertRaises(ValueError): self.engine.request(action, identity)


if __name__ == '__main__': unittest.main()
