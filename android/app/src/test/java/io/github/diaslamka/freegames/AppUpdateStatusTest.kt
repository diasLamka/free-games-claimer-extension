package io.github.diaslamka.freegames

import io.github.diaslamka.freegames.data.AppUpdate
import io.github.diaslamka.freegames.data.AppUpdate.Status
import kotlinx.coroutines.flow.MutableStateFlow
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

/** L'etat de la mise a jour se lit de partout, mais ne s'ecrit que par le code de mise a jour. */
class AppUpdateStatusTest {
    @After
    fun reset() = AppUpdate.publish(Status.Idle)

    @Test
    fun theStatusSeenFromOutsideCannotBeWritten() {
        assertFalse(AppUpdate.status is MutableStateFlow<*>)
    }

    @Test
    fun aPublishedStatusIsWhatTheScreenReads() {
        AppUpdate.publish(Status.Checking)
        assertEquals(Status.Checking, AppUpdate.status.value)
    }
}
