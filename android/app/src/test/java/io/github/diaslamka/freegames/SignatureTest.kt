package io.github.diaslamka.freegames

import androidx.compose.ui.unit.dp
import io.github.diaslamka.freegames.ui.columnsFor
import io.github.diaslamka.freegames.ui.timecodeText
import org.junit.Assert.assertEquals
import org.junit.Test

class SignatureTest {
    private val jours = { d: Long -> "${d}J" }

    @Test
    fun timecodeCountsDownInHoursMinutesSeconds() {
        assertEquals("18:32:07", timecodeText((18 * 3600 + 32 * 60 + 7) * 1000L, jours))
        assertEquals("00:00:59", timecodeText(59_999, jours))
        assertEquals("2J 23:59:59", timecodeText((3 * 86_400 - 1) * 1000L, jours))
        assertEquals("1J 00:00:00", timecodeText(86_400_000, jours))
        assertEquals("00:00:00", timecodeText(-5_000, jours))
    }

    @Test
    fun columnsFollowTheWindowWidth() {
        assertEquals(1, columnsFor(360.dp))
        assertEquals(1, columnsFor(599.dp))
        assertEquals(2, columnsFor(600.dp))
        assertEquals(2, columnsFor(840.dp))
        assertEquals(3, columnsFor(1176.dp))
    }
}
