import asyncio
import unittest
from unittest.mock import patch

import numpy as np
import torch

import api
from core.fingerspelling_geometry import downward_pose, unambiguous_two_finger_pendulum
from core.hybrid_recognizer import compatible_motion_shape, motion_evidence, motion_preparation_start, recognize_hybrid, resample_shape


class FixedShape:
    def __init__(self, probabilities):
        self.probabilities = probabilities
        self.inputs = []

    def __call__(self, frames):
        self.inputs.append(frames.clone())
        return torch.log(torch.tensor([self.probabilities]))


class FixedSequence(FixedShape):
    def __call__(self, frames, lengths):
        self.inputs.append((frames.clone(), lengths.clone()))
        return torch.log(torch.tensor([self.probabilities]))


def gesture(length=18, moving=True):
    frames = np.zeros((length, 126), dtype=np.float32)
    for i in range(length):
        for point in range(21):
            frames[i, 63 + point * 3] = 0.4 + point % 5 * 0.02 + (i * 0.009 if moving else 0)
            frames[i, 64 + point * 3] = 0.3 + point // 5 * 0.03
        # Mano sintética genérica sin la contradicción índice recto/meñique
        # doblado. Las pruebas J/L construyen explícitamente esas formas.
        for mcp in (5, 9, 17):
            for point in range(mcp, mcp + 4):
                frames[i, 63 + point * 3] = 0.42 + (point - mcp) * 0.02 + (i * 0.009 if moving else 0)
                frames[i, 64 + point * 3] = 0.39
    return frames


def oscillating_gesture(length=36):
    frames = downward_gesture(length)
    hand = frames.reshape(-1, 2, 21, 3)[:, 1]
    hand[:, :, 0] += (0.08 * np.sin(np.linspace(0, 2 * np.pi, length)))[:, None]
    return frames


def downward_gesture(length=18, fingers=2):
    frames = gesture(length, False)
    hand = frames.reshape(-1, 2, 21, 3)[:, 1]
    for finger, mcp in enumerate((5, 9, 13, 17)):
        x = .43 + finger*.03
        chain = [[x,.39,0],[x,.42,0],[x,.45,0],[x,.48,0]] if finger < fingers else [
            [x,.39,0],[x+.02,.41,0],[x+.01,.43,0],[x,.40,0]]
        hand[:, mcp:mcp+4] = chain
    return frames


class HybridRecognizerTests(unittest.TestCase):
    def test_downward_n_translation_is_not_g_even_with_high_temporal_score(self):
        frames = downward_gesture(24)
        frames.reshape(-1, 2, 21, 3)[:, 1, :, 0] += np.linspace(0, .09, 24)[:, None]
        self.assertFalse(compatible_motion_shape('G', frames))
        result = recognize_hybrid(frames, FixedShape([.999, .001]), ['N', 'G'],
                                  FixedSequence([.001, .999]), ['N', 'G'], letters_only=True)
        self.assertEqual(result.labels[int(result.probabilities.argmax())], 'N')
        self.assertFalse(result.blocked)

    def test_rejected_downward_g_keeps_whole_n_not_recent_p(self):
        class TransitionShape(FixedShape):
            def __call__(self, frames):
                self.inputs.append(frames.clone())
                return torch.log(torch.tensor([[.001, .999] if len(self.inputs) > 1
                                               else [.999, .001]]))
        frames = downward_gesture(24)
        frames.reshape(-1, 2, 21, 3)[:, 1, :, 0] += np.linspace(0, .09, 24)[:, None]
        shape = TransitionShape([])
        result = recognize_hybrid(frames, shape, ['N', 'P'],
                                  FixedSequence([.999, .001]), ['G', 'N'], letters_only=True)
        self.assertEqual(result.labels[int(result.probabilities.argmax())], 'N')
        self.assertEqual(len(shape.inputs), 1)

    def test_diagonal_entry_with_x_return_is_not_neural_enye(self):
        frames = oscillating_gesture(36)
        frames.reshape(-1, 2, 21, 3)[:, 1, :, 1] += (.16*np.sin(np.linspace(0, 2*np.pi, 36)))[:, None]
        self.assertFalse(compatible_motion_shape('Ñ', frames))

    def test_unknown_ring_frames_do_not_count_as_three_finger_votes(self):
        frames = oscillating_gesture(48)
        hand = frames.reshape(-1, 2, 21, 3)[:, 1]
        # Anular inequívoco en 2/3 de cuadros, intermedio en el resto.
        hand[::3, 16, 1] = .445
        self.assertIsNotNone(unambiguous_two_finger_pendulum(frames))

    def test_lateral_pendulum_tolerates_isolated_vertical_tracking_spikes(self):
        frames = oscillating_gesture(48)
        hand = frames.reshape(-1, 2, 21, 3)[:, 1]
        hand[[9, 22, 35], 12, 1] += .24
        before = frames.copy()
        self.assertIsNotNone(unambiguous_two_finger_pendulum(frames))
        np.testing.assert_array_equal(frames, before)

    def test_independent_finger_swings_are_not_a_verified_pendulum(self):
        frames = oscillating_gesture(48)
        hand = frames.reshape(-1, 2, 21, 3)[:, 1]
        hand[:, 9:13, 0] -= (.16*np.sin(np.linspace(0, 2*np.pi, 48)))[:, None]
        self.assertIsNone(unambiguous_two_finger_pendulum(frames))

    def test_rejected_j_does_not_discard_cadence_h_and_matching_shape(self):
        class ConflictingCadence(FixedSequence):
            def __call__(self, frames, lengths):
                self.inputs.append((frames.clone(), lengths.clone()))
                return torch.log(torch.tensor([[.001, .999] if int(lengths[0]) > 12
                                               else [.999, .001]]))
        frames = gesture(18)
        hand = frames.reshape(-1, 2, 21, 3)[:, 1]
        hand[:, 17:21, :2] = [[.45, .39], [.48, .37], [.45, .35], [.455, .385]]
        self.assertTrue(compatible_motion_shape('H', frames))
        self.assertFalse(compatible_motion_shape('J', frames))
        before = frames.copy()
        temporal = ConflictingCadence([])
        result = recognize_hybrid(frames, FixedShape([.999, .001]), ['H', 'J'],
                                  temporal, ['H', 'J'], letters_only=True)
        self.assertEqual(result.source, 'sequence_motion_corroborated_cadence')
        self.assertFalse(result.blocked)
        self.assertEqual(result.labels[int(result.probabilities.argmax())], 'H')
        self.assertEqual([int(length[0]) for _, length in temporal.inputs], [18, 9])
        self.assertEqual(result.input_frames, 18)
        np.testing.assert_array_equal(frames, before)

    def test_rejected_primary_requires_independent_shape_for_cadence_recovery(self):
        class ConflictingCadence(FixedSequence):
            def __call__(self, frames, lengths):
                return torch.log(torch.tensor([[.001, .999] if int(lengths[0]) > 12
                                               else [.999, .001]]))
        frames = gesture(18)
        hand = frames.reshape(-1, 2, 21, 3)[:, 1]
        hand[:, 17:21, :2] = [[.45, .39], [.48, .37], [.45, .35], [.455, .385]]
        result = recognize_hybrid(frames, FixedShape([.999, .001]), ['L', 'H'],
                                  ConflictingCadence([]), ['H', 'J'], letters_only=True)
        self.assertEqual(result.source, 'motion_shape_rejected')
        self.assertEqual(result.labels[int(result.probabilities.argmax())], 'L')

    def test_two_finger_pendulum_resolves_strong_m_family_read_with_provenance(self):
        for alphabet in (False, True):
            for direction in (1, -1):
                frames = oscillating_gesture()
                if direction == -1:
                    frames = frames[::-1].copy()
                before = frames.copy()
                result = recognize_hybrid(frames, FixedShape([.998,.001,.001]), ['M','N','Ñ'],
                                          FixedSequence([.998,.001,.001]), ['M','N','Ñ'],
                                          letters_only=alphabet)
                self.assertEqual(result.source, 'verified_finger_pendulum')
                self.assertEqual(result.labels[int(result.probabilities.argmax())], 'Ñ')
                self.assertGreater(result.probabilities.max(), .94)
                self.assertTrue(result.pose_evidence['lateral_return'])
                np.testing.assert_array_equal(frames, before)

    def test_auxiliary_pendulum_does_not_promote_word_or_residual_family(self):
        for shape_probs, temporal_probs in (([.999,.0005,.0005], [.001,.998,.001]),
                                             ([.001,.998,.001], [.999,.0005,.0005])):
            result = recognize_hybrid(oscillating_gesture(), FixedShape(shape_probs), ['BIEN','M','Ñ'],
                                      FixedSequence(temporal_probs), ['BIEN','M','Ñ'], letters_only=True)
            self.assertNotEqual(result.source, 'verified_finger_pendulum')

    def test_auxiliary_pendulum_does_not_relabel_static_n_or_three_finger_m(self):
        three = downward_gesture(36, fingers=3)
        three.reshape(-1,2,21,3)[:,1,:,0] += (.08*np.sin(np.linspace(0,2*np.pi,36)))[:,None]
        for frames in (downward_gesture(36), three):
            result = recognize_hybrid(frames, FixedShape([.998,.001,.001]), ['M','N','Ñ'],
                                      FixedSequence([.998,.001,.001]), ['M','N','Ñ'], letters_only=True)
            self.assertNotEqual(result.labels[int(result.probabilities.argmax())], 'Ñ')

    def test_auxiliary_pendulum_rejects_vertical_reposition_and_uncertain_ring(self):
        diagonal = oscillating_gesture()
        diagonal.reshape(-1,2,21,3)[:,1,:,1] += (.16*np.sin(np.linspace(0,2*np.pi,36)))[:,None]
        occluded = oscillating_gesture()
        occluded.reshape(-1,2,21,3)[:18,1,13:17] = downward_gesture(18,fingers=3).reshape(-1,2,21,3)[:,1,13:17]
        for frames in (diagonal, occluded):
            result = recognize_hybrid(frames, FixedShape([.998,.001,.001]), ['M','N','Ñ'],
                                      FixedSequence([.998,.001,.001]), ['M','N','Ñ'], letters_only=True)
            self.assertNotEqual(result.source, 'verified_finger_pendulum')

    def test_auxiliary_pendulum_cannot_overwrite_confident_other_neural_letter(self):
        result = recognize_hybrid(oscillating_gesture(), FixedShape([.998,.001,.001]), ['M','N','Ñ'],
                                  FixedSequence([.001,.998,.001]), ['M','Z','Ñ'], letters_only=True)
        self.assertEqual(result.source, 'sequence_motion')
        self.assertEqual(result.labels[int(result.probabilities.argmax())], 'Z')

    def test_pendulum_in_both_directions_and_stationary_wrist(self):
        for direction in (1, -1):
            frames = downward_gesture(36)
            hand = frames.reshape(-1,2,21,3)[:,1]
            swing = direction*.06*np.sin(np.linspace(0,2*np.pi,36))
            hand[:,5:13,0] += swing[:,None]
            self.assertTrue(compatible_motion_shape('Ñ',frames))

    def test_small_tracking_gap_is_not_a_missing_pendulum(self):
        frames=oscillating_gesture()
        frames[10]=0
        self.assertTrue(compatible_motion_shape('Ñ',frames))
        frames[8:20]=0
        self.assertFalse(compatible_motion_shape('Ñ',frames))

    def test_tiny_reversals_during_reposition_are_not_pendulum(self):
        frames=downward_gesture(80)
        hand=frames.reshape(-1,2,21,3)[:,1]
        hand[:,:,0] += (np.linspace(0,.1,80)+.002*np.sin(np.arange(80)))[:,None]
        self.assertFalse(compatible_motion_shape('Ñ',frames))

    def test_short_or_ambiguous_downward_pose_is_unknown(self):
        self.assertIsNone(downward_pose(downward_gesture(5)))
        frames=downward_gesture(8)
        frames[3]=0
        self.assertIsNone(downward_pose(frames))
        self.assertIsNone(downward_pose(gesture(8,False)))

    def test_occluded_ring_does_not_rigidly_veto_neural_enye(self):
        frames=oscillating_gesture()
        hand=frames.reshape(-1,2,21,3)[:,1]
        hand[:6,13:17] = downward_gesture(6,fingers=3).reshape(-1,2,21,3)[:,1,13:17]
        self.assertTrue(compatible_motion_shape('Ñ',frames))

    def test_verified_two_down_fingers_resolve_m_n_confusion(self):
        result = recognize_hybrid(downward_gesture(), FixedShape([.999,.001]), ['M','N'],
                                  FixedSequence([.999,.001]), ['M','N'], letters_only=True)
        self.assertEqual(result.labels[int(result.probabilities.argmax())], 'N')
        self.assertEqual(result.source, 'verified_finger_pose')
        self.assertEqual(result.pose_evidence['label'], 'N')

    def test_verified_three_down_fingers_resolve_n_m_confusion(self):
        result = recognize_hybrid(downward_gesture(fingers=3), FixedShape([.999,.001]), ['N','M'],
                                  FixedSequence([.999,.001]), ['N','M'], letters_only=True)
        self.assertEqual(result.labels[int(result.probabilities.argmax())], 'M')
        self.assertEqual(result.source, 'verified_finger_pose')

    def test_three_down_fingers_with_pendulum_do_not_become_enye(self):
        frames = downward_gesture(30, fingers=3)
        frames.reshape(-1,2,21,3)[:,1,:,0] += (.08*np.sin(np.linspace(0,2*np.pi,30)))[:,None]
        self.assertFalse(compatible_motion_shape('Ñ', frames))

    def test_vertical_pendulum_does_not_become_enye(self):
        frames = downward_gesture(30)
        frames.reshape(-1,2,21,3)[:,1,:,1] += (.08*np.sin(np.linspace(0,2*np.pi,30)))[:,None]
        self.assertFalse(compatible_motion_shape('Ñ', frames))

    def test_pose_does_not_promote_residual_word_probability_to_n(self):
        result = recognize_hybrid(downward_gesture(), FixedShape([.999,.0005,.0005]), ['BIEN','M','N'],
                                  FixedSequence([.999,.001]), ['BIEN','Ñ'], letters_only=True)
        self.assertEqual(result.labels[int(result.probabilities.argmax())], 'BIEN')
        self.assertIsNone(result.pose_evidence)

    def test_entering_hand_is_not_enye(self):
        frames = gesture(20)
        self.assertFalse(compatible_motion_shape('Ñ', frames))
        result = recognize_hybrid(frames, FixedShape([0.999, 0.001]), ['N', 'Ñ'],
                                  FixedSequence([0.001, 0.999]), ['N', 'Ñ'], letters_only=True)
        self.assertEqual(result.source, 'motion_shape_rejected')
        self.assertEqual(result.labels[int(result.probabilities.argmax())], 'N')

    def test_large_h_is_not_vetoed_by_amplitude_or_forced_to_z(self):
        frames = gesture(36, False)
        frames.reshape(-1,2,21,3)[:,1,:,0] += (.08*np.sin(np.linspace(0,2*np.pi,36)))[:,None]
        self.assertTrue(compatible_motion_shape('H', frames))
        result = recognize_hybrid(frames, FixedShape([0.001, 0.999]), ['H', 'Z'],
                                  FixedSequence([0.999, 0.001]), ['H', 'Z'], letters_only=True)
        self.assertFalse(result.blocked)
        self.assertEqual(result.labels[int(result.probabilities.argmax())], 'H')

    def test_first_h_can_resolve_confident_local_word_with_temporal_corroboration(self):
        result = recognize_hybrid(gesture(),FixedShape([.999,.001]),['COMO_ESTAS','H'],
                                  FixedSequence([.001,.999]),['COMO_ESTAS','H'])
        self.assertEqual(result.source,'sequence_motion_word_conflict')
        self.assertEqual(result.labels[int(result.probabilities.argmax())],'H')

    def test_first_word_disagreement_needs_matching_cadence_and_shape(self):
        class Conflicting(FixedSequence):
            def __call__(self,frames,lengths):
                self.inputs.append((frames.clone(),lengths.clone()))
                return torch.log(torch.tensor([[.001,.998,.001] if int(lengths[0])>12 else [.001,.001,.998]]))
        result=recognize_hybrid(gesture(),FixedShape([.999,.0005,.0005]),['BIEN','G','H'],
                                Conflicting([]),['BIEN','G','H'])
        self.assertEqual(result.source,'legacy_shape')
        self.assertEqual(result.labels[int(result.probabilities.argmax())],'BIEN')

    def test_one_hand_does_not_confirm_registered_two_hand_word_before_first_letter(self):
        result=recognize_hybrid(gesture(9),FixedShape([.999,.001]),['COMO_ESTAS','H'],
                                FixedSequence([.999,.001]),['BIEN','H'])
        self.assertTrue(result.blocked)
        self.assertEqual(result.source,'word_hand_contradiction')

    def test_enye_preparation_keeps_entire_lateral_stroke(self):
        frames=oscillating_gesture(30)
        hand=frames.reshape(-1,2,21,3)[:,1]
        hand[:6,9:13,:2]=[[.45,.39],[.48,.37],[.45,.35],[.455,.385]]
        before=frames.copy()
        self.assertEqual(motion_preparation_start('Ñ',frames),6)
        np.testing.assert_array_equal(frames,before)

    def test_single_preparation_boundary_preserves_input(self):
        frames = gesture(24)
        hand = frames.reshape(-1, 2, 21, 3)[:, 1]
        hand[:6, 9:13, :2] = [[0.45, 0.39], [0.48, 0.37], [0.45, 0.35], [0.455, 0.385]]
        before = frames.copy()
        self.assertEqual(motion_preparation_start('H', frames), 6)
        self.assertEqual(motion_preparation_start('H', frames[6:]), 0)
        self.assertEqual(motion_preparation_start('Z', frames), 0)

        class PreparedSequence(FixedSequence):
            def __call__(self, tensor, lengths):
                self.inputs.append((tensor.clone(), lengths.clone()))
                return torch.log(torch.tensor([[0.999, 0.001] if int(lengths[0]) == 24 else [0.001, 0.999]]))

        model = PreparedSequence([])
        result = recognize_hybrid(frames, FixedShape([0.001, 0.999]), ['H', 'Z'],
                                  model, ['H', 'Z'], letters_only=True)
        self.assertEqual(result.labels[int(result.probabilities.argmax())], 'Z')
        self.assertEqual(result.preparation_frames, 6)
        self.assertEqual(result.input_frames, 24)
        self.assertEqual(result.evaluated_frames, 18)
        self.assertEqual([int(lengths[0]) for _, lengths in model.inputs], [24, 18])
        np.testing.assert_array_equal(before, frames)

    def test_four_straight_fingers_are_not_g_motion_evidence(self):
        frames = gesture(24)
        hand = frames.reshape(-1, 2, 21, 3)[:, 1]
        for frame in hand:
            for mcp in (5, 9, 13, 17):
                frame[mcp:mcp+4] = np.array([frame[mcp] + [0.02*i, 0, 0] for i in range(4)])
        self.assertFalse(compatible_motion_shape('G', frames))
        result = recognize_hybrid(frames, FixedShape([0.999, 0.001]), ['N', 'G'],
                                  FixedSequence([0.001, 0.999]), ['N', 'G'], letters_only=True)
        self.assertNotEqual(result.source, 'sequence_motion')
        self.assertEqual(result.labels[int(result.probabilities.argmax())], 'N')

    def test_recent_held_n_is_not_buried_under_previous_m(self):
        class ShapeChanges(FixedShape):
            def __call__(self, frames):
                self.inputs.append(frames.clone())
                return torch.log(torch.tensor([[0.999, 0.001] if len(self.inputs) == 1 else [0.001, 0.999]]))
        movement = gesture(20)
        frames = np.concatenate([movement, np.repeat(movement[-1:], 10, axis=0)])
        result = recognize_hybrid(frames, ShapeChanges([]), ['M', 'N'],
                                  FixedSequence([0.999, 0.001]), ['M', 'N'], letters_only=True)
        self.assertEqual(result.source, 'legacy_recent_pose')
        self.assertEqual(result.labels[int(result.probabilities.argmax())], 'N')

    def test_n_motion_is_not_replaced_with_a_static_pose_read(self):
        shape = FixedShape([0.999, 0.001])
        result = recognize_hybrid(gesture(30), shape, ['M', 'N'],
                                  FixedSequence([0.999, 0.001]), ['M', 'N'], letters_only=True)
        self.assertEqual(result.source, 'legacy_shape')
        self.assertEqual(len(shape.inputs), 1, 'no relectura de pose mientras sigue el trazo')

    def test_temporal_enye_has_priority_over_held_n_shape(self):
        movement = oscillating_gesture(20)
        frames = np.concatenate([movement, np.repeat(movement[-1:], 10, axis=0)])
        result = recognize_hybrid(frames, FixedShape([0.999, 0.001]), ['N', 'Ñ'],
                                  FixedSequence([0.001, 0.999]), ['N', 'Ñ'], letters_only=True)
        self.assertEqual(result.source, 'sequence_motion')
        self.assertEqual(result.labels[int(result.probabilities.argmax())], 'Ñ')

    def test_h_rejects_l_or_closed_fist_prefix(self):
        frames = gesture(6)
        hand = frames.reshape(-1, 2, 21, 3)[:, 1]
        for frame in hand:
            frame[9:13, :2] = [[0.45, 0.39], [0.48, 0.37], [0.45, 0.35], [0.455, 0.385]]
        self.assertFalse(compatible_motion_shape('H', frames))
        result = recognize_hybrid(frames, FixedShape([0.99, 0.01]), ['L', 'H'],
                                  FixedSequence([0.01, 0.99]), ['L', 'H'], letters_only=True)
        self.assertEqual(result.source, 'motion_shape_rejected')
        self.assertEqual(result.labels[int(result.probabilities.argmax())], 'L')

    def test_h_shape_guard_never_emits_h_without_temporal_vote(self):
        frames = gesture(18)
        self.assertTrue(compatible_motion_shape('H', frames))
        result = recognize_hybrid(frames, FixedShape([0.99, 0.01]), ['K', 'H'],
                                  FixedSequence([0.99, 0.01]), ['K', 'H'], letters_only=True)
        self.assertEqual(result.source, 'legacy_shape')

    def test_translation_of_l_does_not_become_j(self):
        frames = gesture(24)
        hand = frames.reshape(-1, 2, 21, 3)[:, 1]
        for frame in hand:
            frame[17:21, :2] = [[0.45, 0.39], [0.48, 0.37], [0.45, 0.35], [0.455, 0.385]]
        # El índice queda recto y el meñique plegado durante todo el traslado.
        self.assertFalse(compatible_motion_shape('J', frames))
        result = recognize_hybrid(frames, FixedShape([0.99, 0.01]), ['L', 'J'],
                                  FixedSequence([0.01, 0.99]), ['L', 'J'], letters_only=True)
        self.assertEqual(result.source, 'motion_shape_rejected')
        self.assertEqual(result.labels[int(result.probabilities.argmax())], 'L')
        self.assertFalse(result.blocked)

    def test_spelling_s_is_not_vetoed_by_legacy_no(self):
        with patch.object(api, 'HYBRID_ENABLED', True), \
             patch.object(api, 'MODEL_VARIANT', 'legacy'), \
             patch.object(api, '_model', FixedShape([0.999, 0.001])), \
             patch.object(api, '_labels', ['NO', 'S']), \
             patch.object(api, '_sequence_model', FixedSequence([0.001, 0.999])), \
             patch.object(api, '_sequence_labels', ['NO', 'S']):
            result = asyncio.run(api.predict_sequence(api.PredictRequest(frames=gesture(24).tolist(), letters_only=True)))
            self.assertEqual(result.prediction, 'S')
            self.assertEqual(result.recognition_source, 'sequence_motion')

    def test_j_requires_unfolded_pinky_not_just_any_movement(self):
        frames = gesture(24)
        hand = frames.reshape(-1, 2, 21, 3)[:, 1]
        for frame in hand:
            frame[17:21, :2] = [[0.45, 0.39], [0.48, 0.37], [0.45, 0.35], [0.455, 0.385]]
            frame[5:9, :2] = [[0.40, 0.33], [0.43, 0.31], [0.40, 0.29], [0.405, 0.325]]
        self.assertFalse(compatible_motion_shape('J', frames))

    def test_shape_adapter_does_not_cut_long_gestures(self):
        frames = gesture(90)
        before = frames.copy()
        adapted = resample_shape(frames)
        self.assertEqual(len(adapted), 24)
        np.testing.assert_array_equal(adapted[0], frames[0])
        np.testing.assert_array_equal(adapted[-1], frames[-1])
        np.testing.assert_array_equal(frames, before)

    def test_static_letters_keep_git_model_at_any_camera_length(self):
        for length in (6, 12, 24, 48, 90):
            with self.subTest(length=length):
                shape = FixedShape([0.99, 0.01])
                temporal = FixedSequence([0.01, 0.99])
                result = recognize_hybrid(gesture(length, False), shape, ['A', 'H'], temporal, ['A', 'H'])
                self.assertEqual(result.source, 'legacy_shape')
                self.assertEqual(result.labels[int(result.probabilities.argmax())], 'A')
                self.assertFalse(temporal.inputs, 'el prior H de 6 cuadros no decide una postura A')
                self.assertEqual(shape.inputs[0].shape[1], 24)

    def test_complete_trajectory_overrides_intermediate_i_shape(self):
        shape, temporal = FixedShape([0.99, 0.01]), FixedSequence([0.01, 0.99])
        result = recognize_hybrid(gesture(55), shape, ['I', 'J'], temporal, ['I', 'J'])
        self.assertEqual(result.source, 'sequence_motion')
        self.assertEqual(result.labels[int(result.probabilities.argmax())], 'J')
        self.assertEqual(int(temporal.inputs[0][1][0]), 55)
        self.assertEqual(temporal.inputs[0][0].shape[1], 55)

    def test_static_h_is_not_invented_by_legacy_model(self):
        result = recognize_hybrid(gesture(12, False), FixedShape([0.01, 0.99]), ['A', 'H'],
                                  FixedSequence([0.01, 0.99]), ['A', 'H'])
        self.assertTrue(result.blocked)

    def test_cadence_fallback_keeps_full_path_endpoints(self):
        class CadenceSensitive(FixedSequence):
            def __call__(self, frames, lengths):
                self.inputs.append((frames.clone(), lengths.clone()))
                return torch.log(torch.tensor([[0.99, 0.01] if int(lengths[0]) > 20 else [0.01, 0.99]]))
        model = CadenceSensitive([])
        frames = oscillating_gesture(36)
        result = recognize_hybrid(frames, FixedShape([0.99, 0.01]), ['N', 'Ñ'], model, ['N', 'Ñ'])
        self.assertEqual(result.source, 'sequence_motion_cadence')
        self.assertEqual([int(length[0]) for _, length in model.inputs], [36, 18])
        self.assertEqual(result.input_frames, 36)
        # El ancla normalizada (mediana de tres cuadros) cambia con la cadencia;
        # comprobar los extremos RAW, no exigir anclas numéricamente idénticas.
        adapted = resample_shape(frames, 18)
        np.testing.assert_array_equal(adapted[0], frames[0])
        np.testing.assert_array_equal(adapted[-1], frames[-1])

    def test_no_hands_or_constant_pose_is_not_trajectory(self):
        self.assertFalse(motion_evidence(np.zeros((20, 126), np.float32)))
        self.assertFalse(motion_evidence(gesture(20, False)))
        self.assertTrue(motion_evidence(gesture(20)))

    def test_first_letter_does_not_overwrite_confident_word(self):
        shape, temporal = FixedShape([0.99, 0.01]), FixedSequence([0.01, 0.99])
        result = recognize_hybrid(gesture(), shape, ['MAL', 'Ñ'], temporal, ['MAL', 'Ñ'])
        self.assertEqual(result.source, 'legacy_shape')
        self.assertEqual(len(temporal.inputs), 1, 'comprobar recorrido no basta para emitir una Ñ incompatible')

    def test_motion_can_rescue_first_letter_despite_legacy_word(self):
        class WordClipAlphabetPoses(FixedShape):
            def __call__(self, frames):
                self.inputs.append(frames.clone())
                return torch.log(torch.tensor([[0.99, 0.01] if len(self.inputs) == 1 else [0.01, 0.99]]))
        result = recognize_hybrid(gesture(), WordClipAlphabetPoses([]), ['BIEN', 'G'],
                                  FixedSequence([0.01, 0.99]), ['BIEN', 'G'])
        self.assertEqual(result.source, 'sequence_motion')

    def test_idle_prior_does_not_veto_a_real_first_motion_letter(self):
        result = recognize_hybrid(gesture(), FixedShape([0.99, 0.01]), ['IDLE', 'J'],
                                  FixedSequence([0.01, 0.99]), ['IDLE', 'J'])
        self.assertEqual(result.source, 'sequence_motion')

    def test_uncorroborated_motion_disagreement_abstains(self):
        class DisagreeingCadence(FixedSequence):
            def __call__(self, frames, lengths):
                return torch.log(torch.tensor([[0.001, 0.998, 0.001] if int(lengths[0]) > 20
                                               else [0.001, 0.001, 0.998]]))
        result = recognize_hybrid(gesture(36), FixedShape([0.99, 0.005, 0.005]), ['H', 'G', 'J'],
                                  DisagreeingCadence([]), ['H', 'G', 'J'])
        self.assertTrue(result.blocked)
        self.assertEqual(result.source, 'hybrid_conflict')

    def test_old_motion_error_does_not_veto_two_matching_temporal_reads(self):
        result = recognize_hybrid(gesture(36), FixedShape([0.99, 0.01]), ['G', 'H'],
                                  FixedSequence([0.01, 0.99]), ['G', 'H'])
        self.assertEqual(result.source, 'sequence_motion')
        self.assertFalse(result.blocked)

    def test_isolated_s_against_z_without_cadence_support_abstains(self):
        class MixedTrajectory(FixedSequence):
            def __call__(self, frames, lengths):
                return torch.log(torch.tensor([[0.001, 0.998, 0.001] if int(lengths[0]) > 20
                                               else [0.001, 0.001, 0.998]]))
        result = recognize_hybrid(gesture(36), FixedShape([0.998, 0.001, 0.001]), ['Z', 'S', 'NO'],
                                  MixedTrajectory([]), ['Z', 'S', 'NO'], letters_only=True)
        self.assertTrue(result.blocked)
        self.assertEqual(result.source, 'hybrid_conflict')

    def test_short_conflicting_motion_read_does_not_force_either_letter(self):
        result = recognize_hybrid(gesture(10), FixedShape([0.99, 0.01]), ['Z', 'S'],
                                  FixedSequence([0.01, 0.99]), ['Z', 'S'], letters_only=True)
        self.assertTrue(result.blocked)
        self.assertEqual(result.source, 'hybrid_conflict')

    def test_s_z_conflict_check_does_not_change_h_recovery(self):
        class CadenceSensitive(FixedSequence):
            def __call__(self, frames, lengths):
                return torch.log(torch.tensor([[0.001, 0.998, 0.001] if int(lengths[0]) > 20
                                               else [0.001, 0.001, 0.998]]))
        result = recognize_hybrid(gesture(36), FixedShape([0.998, 0.001, 0.001]), ['G', 'H', 'NO'],
                                  CadenceSensitive([]), ['G', 'H', 'NO'], letters_only=True)
        self.assertEqual(result.source, 'sequence_motion')
        self.assertFalse(result.blocked)
        self.assertEqual(result.labels[int(result.probabilities.argmax())], 'H')

    def test_two_models_agreeing_on_word_do_not_probe_fake_cadence_letter(self):
        temporal = FixedSequence([0.99, 0.01])
        result = recognize_hybrid(gesture(), FixedShape([0.99, 0.01]), ['GRACIAS', 'J'],
                                  temporal, ['GRACIAS', 'J'])
        self.assertEqual(result.source, 'legacy_shape')
        self.assertEqual(len(temporal.inputs), 1, 'no cambiar cadencia para buscar una letra si ambas ramas dicen palabra')

    def test_conflicting_motion_letters_require_temporal_support_for_shape(self):
        class CadenceSensitive(FixedSequence):
            def __call__(self, frames, lengths):
                self.inputs.append((frames.clone(), lengths.clone()))
                return torch.log(torch.tensor([[0.01, 0.99] if int(lengths[0]) > 20 else [0.99, 0.01]]))
        result = recognize_hybrid(gesture(36), FixedShape([0.99, 0.01]), ['H', 'G'],
                                  CadenceSensitive([]), ['H', 'G'])
        self.assertEqual(result.source, 'sequence_motion_cadence')
        self.assertEqual(result.labels[int(result.probabilities.argmax())], 'H')

    def test_api_alphabet_and_ambiguous_m_n(self):
        for probabilities, expected in (([0.94, 0.05, 0.01], 'M'), ([0.05, 0.94, 0.01], 'N'), ([0.55, 0.44, 0.01], '')):
            with self.subTest(expected=expected), \
                 patch.object(api, 'HYBRID_ENABLED', True), \
                 patch.object(api, 'MODEL_VARIANT', 'legacy'), \
                 patch.object(api, '_model', FixedShape(probabilities)), \
                 patch.object(api, '_labels', ['M', 'N', 'BIEN']), \
                 patch.object(api, '_sequence_model', FixedSequence([0.99, 0.01])), \
                 patch.object(api, '_sequence_labels', ['H', 'IDLE']):
                response = asyncio.run(api.predict_sequence(api.PredictRequest(frames=gesture(6, False).tolist(), letters_only=True)))
                self.assertEqual(response.prediction, expected)
                self.assertEqual(response.recognition_source, 'legacy_shape')


if __name__ == '__main__':
    unittest.main()
