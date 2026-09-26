package io.github.diaslamka.freegames.sources

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import java.time.Instant
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter

val JSON = Json { ignoreUnknownKeys = true; explicitNulls = false; encodeDefaults = true }

fun parseJson(text: String?): JsonElement? = try {
    if (text.isNullOrBlank()) null else JSON.parseToJsonElement(text)
} catch (_: Exception) {
    null
}

val JsonElement?.obj: JsonObject? get() = this as? JsonObject
val JsonElement?.arr: JsonArray? get() = this as? JsonArray

/** Une chaine, et seulement une chaine. */
val JsonElement?.str: String? get() = (this as? JsonPrimitive)?.takeIf { it.isString }?.content

/** Une chaine ou un nombre, en texte. */
val JsonElement?.text: String? get() = (this as? JsonPrimitive)?.takeUnless { it is JsonNull }?.content

val JsonElement?.num: Double? get() = (this as? JsonPrimitive)?.takeUnless { it is JsonNull }?.content?.toDoubleOrNull()
val JsonElement?.bool: Boolean? get() = (this as? JsonPrimitive)?.takeUnless { it.isString }?.booleanOrNull

operator fun JsonElement?.get(key: String): JsonElement? = (this as? JsonObject)?.get(key)
operator fun JsonElement?.get(index: Int): JsonElement? = (this as? JsonArray)?.getOrNull(index)

object Dates {
    /** « 2026-08-20T15:00:00.000Z » : un instant avec son fuseau, ou null. */
    fun iso(raw: String?): Long? {
        if (raw.isNullOrBlank()) return null
        return try {
            Instant.parse(raw.trim()).toEpochMilli()
        } catch (_: Exception) {
            try {
                OffsetDateTime.parse(raw.trim()).toInstant().toEpochMilli()
            } catch (_: Exception) {
                null
            }
        }
    }

    private val NAIVE = Regex("^(\\d{4})-(\\d{2})-(\\d{2})[ T](\\d{2}):(\\d{2})(?::(\\d{2}))?$")

    /**
     * Une date SANS fuseau, dans le fuseau declare : gamerpower ecrit l'heure
     * de New York (watch/sources/gamerpower.js). Une date avec fuseau passe
     * par `iso`.
     */
    fun inZone(raw: String?, zone: String): Long? {
        val s = raw?.trim().orEmpty()
        if (s.isEmpty() || s.equals("N/A", ignoreCase = true) || s.equals("NA", ignoreCase = true)) return null
        val m = NAIVE.matchEntire(s) ?: return iso(s)
        val (a, mo, j, h, mi, sec) = m.destructured
        return try {
            LocalDateTime.of(a.toInt(), mo.toInt(), j.toInt(), h.toInt(), mi.toInt(), sec.ifEmpty { "0" }.toInt())
                .atZone(ZoneId.of(zone)).toInstant().toEpochMilli()
        } catch (_: Exception) {
            null
        }
    }

    val ISO_OUT: DateTimeFormatter = DateTimeFormatter.ISO_INSTANT
}
