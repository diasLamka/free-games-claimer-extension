package io.github.diaslamka.freegames.data

import io.github.diaslamka.freegames.BuildConfig
import io.github.diaslamka.freegames.model.AppState
import io.github.diaslamka.freegames.model.TasteState
import io.github.diaslamka.freegames.model.TonightPick
import io.github.diaslamka.freegames.sources.JSON
import kotlinx.serialization.Serializable
import java.nio.ByteBuffer
import java.security.SecureRandom
import java.time.Instant
import java.time.ZoneOffset
import javax.crypto.Cipher
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.PBEKeySpec
import javax.crypto.spec.SecretKeySpec

/**
 * La sauvegarde COMPLETE et chiffree (1.28.0), pour changer de telephone ou se proteger d'une perte : tes reglages, ta
 * bibliotheque, tes souhaits, ce que le moteur a appris, tes proches -- chiffres par une phrase de passe que toi seul connais.
 * Ce n'est pas l'export de l'extension (BackupIO) : celui-ci est un aller-retour en clair, sans reglages.
 *
 * Jamais de session de magasin (les cookies restent dans le WebView du telephone), de secret du relais, ni de jeton : apres une
 * restauration, on se reconnecte aux magasins et on re-associe le PC.
 *
 * Le fichier : « FGCV », la version, le nombre d'iterations, le sel, le vecteur, puis le contenu chiffre (AES-256-GCM, cle
 * derivee de la phrase par PBKDF2-HMAC-SHA256). L'en-tete est authentifie avec le contenu : on ne change pas un octet sans que
 * la lecture echoue.
 */
object BackupVault {
    const val VERSION = 1
    const val ITERATIONS = 210_000

    /** Un fichier qui annonce plus d'iterations qu'on n'en ecrit jamais n'est pas un fichier de l'appli : il ferait tourner le telephone des heures. */
    const val MAX_ITERATIONS = 1_000_000
    const val MIN_PASSPHRASE = 8
    const val MAX_BYTES = 8 * 1024 * 1024

    private val MAGIC = byteArrayOf(0x46, 0x47, 0x43, 0x56) // « FGCV »
    private const val SALT_LEN = 16
    private const val IV_LEN = 12
    private const val TAG_LEN = 16
    private const val HEADER_LEN = 4 + 1 + 4 + SALT_LEN + IV_LEN

    @Serializable
    private data class Envelope(val format: Int, val app: String, val at: String, val state: AppState)

    /** Ce qui merite d'etre garde, et rien d'autre : une liste blanche, pour qu'un champ ajoute demain ne parte pas par megarde. */
    fun snapshot(state: AppState): AppState = AppState(
        // L'image d'une preuve reste sur ce telephone : la sauvegarde n'en garde pas le nom.
        library = state.library.mapValues { it.value.copy(proof = null) },
        wishlist = state.wishlist,
        importedWishes = state.importedWishes,
        deja = state.deja,
        steamOwned = state.steamOwned,
        // Le dossier et l'heure de la sauvegarde automatique sont a CE telephone : une adresse de stockage n'a pas de sens ailleurs.
        settings = state.settings.copy(backupFolder = null, backupAt = null, backupError = null),
        engine = state.engine.filterKeys { BackupIO.ENGINE_KEYS.matches(it) },
        importedAt = state.importedAt,
        taste = state.taste,
        passes = state.passes,
        givers = state.givers,
        owned = state.owned,
        marks = state.marks,
        tonight = state.tonight,
        // Les proches : leur nom, leurs jeux et ce que le moteur a appris pour eux. Leurs sessions restent dans le WebView de ce telephone.
        family = state.family.map { it.copy(accounts = emptyMap(), attempts = emptyMap(), engine = it.engine.filterKeys { k -> BackupIO.ENGINE_KEYS.matches(k) }) },
    )

    /**
     * Remet un instantane dans l'etat courant : les reglages sont remplaces (sauf ce qui tient a CE telephone), tout le reste est
     * fusionne et ce qui est deja la l'emporte -- rien de local n'est perdu. Restaurer deux fois ne change plus rien.
     */
    fun restore(current: AppState, incoming: AppState): AppState {
        // Le fichier est une ENTREE : venu d'ailleurs, il peut porter plus que ce que cette appli ecrit (une cle du moteur, une session,
        // le relais d'un autre). La liste blanche s'applique donc a la restauration comme a la sauvegarde.
        val snapshot = snapshot(incoming)
        return current.copy(
            library = snapshot.library + current.library,
            wishlist = (current.wishlist + snapshot.wishlist).distinct(),
            importedWishes = (current.importedWishes + snapshot.importedWishes).distinct(),
            deja = snapshot.deja + current.deja,
            steamOwned = (current.steamOwned + snapshot.steamOwned).distinct(),
            settings = snapshot.settings.copy(
                backupFolder = current.settings.backupFolder,
                backupAt = current.settings.backupAt,
                backupError = current.settings.backupError,
                // « Premiere ouverture faite » : sur un telephone neuf, la permission de notifications doit encore etre demandee.
                onboarded = current.settings.onboarded,
            ),
            engine = snapshot.engine + current.engine,
            importedAt = current.importedAt ?: snapshot.importedAt,
            taste = if (current.taste == TasteState()) snapshot.taste else current.taste,
            passes = (snapshot.passes.keys + current.passes.keys).associateWith { k -> ((snapshot.passes[k] ?: emptyList()) + (current.passes[k] ?: emptyList())).distinct() },
            givers = snapshot.givers + current.givers,
            owned = snapshot.owned + current.owned,
            marks = snapshot.marks + current.marks,
            tonight = if (current.tonight == TonightPick()) snapshot.tonight else current.tonight,
            family = current.family + snapshot.family.filter { m -> current.family.none { it.id == m.id } },
        )
    }

    fun acceptable(passphrase: String): Boolean = passphrase.length >= MIN_PASSPHRASE

    private fun derive(passphrase: String, salt: ByteArray, iterations: Int): SecretKeySpec {
        val spec = PBEKeySpec(passphrase.toCharArray(), salt, iterations, 256)
        try {
            return SecretKeySpec(SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).encoded, "AES")
        } finally {
            spec.clearPassword()
        }
    }

    fun seal(state: AppState, passphrase: String, now: Long, iterations: Int = ITERATIONS): ByteArray {
        require(iterations in 1..MAX_ITERATIONS) { "iterations hors limites" }
        val random = SecureRandom()
        val salt = ByteArray(SALT_LEN).also(random::nextBytes)
        val iv = ByteArray(IV_LEN).also(random::nextBytes)
        val header = ByteBuffer.allocate(HEADER_LEN).put(MAGIC).put(VERSION.toByte()).putInt(iterations).put(salt).put(iv).array()
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, derive(passphrase, salt, iterations), GCMParameterSpec(TAG_LEN * 8, iv))
        cipher.updateAAD(header)
        val envelope = Envelope(VERSION, BuildConfig.VERSION_NAME, Instant.ofEpochMilli(now).toString(), snapshot(state))
        return header + cipher.doFinal(JSON.encodeToString(Envelope.serializer(), envelope).toByteArray(Charsets.UTF_8))
    }

    /** L'etat sauvegarde, ou null : mauvaise phrase de passe, fichier abime ou modifie, ou pas une sauvegarde de l'appli. */
    fun open(bytes: ByteArray, passphrase: String): AppState? {
        if (bytes.size < HEADER_LEN + TAG_LEN || bytes.size > MAX_BYTES + HEADER_LEN + TAG_LEN) return null
        val buf = ByteBuffer.wrap(bytes)
        val magic = ByteArray(MAGIC.size).also(buf::get)
        if (!magic.contentEquals(MAGIC) || buf.get().toInt() != VERSION) return null
        val iterations = buf.getInt()
        if (iterations !in 1..MAX_ITERATIONS) return null
        val salt = ByteArray(SALT_LEN).also(buf::get)
        val iv = ByteArray(IV_LEN).also(buf::get)
        return try {
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, derive(passphrase, salt, iterations), GCMParameterSpec(TAG_LEN * 8, iv))
            cipher.updateAAD(bytes, 0, HEADER_LEN)
            val plain = cipher.doFinal(bytes, HEADER_LEN, bytes.size - HEADER_LEN)
            JSON.decodeFromString(Envelope.serializer(), plain.decodeToString()).takeIf { it.format == VERSION }?.state
        } catch (_: Exception) {
            // Mauvaise phrase, octet change, contenu d'une autre forme : rien de plus precis ne doit sortir.
            null
        }
    }

    fun fileName(now: Long): String = "fgc-sauvegarde-" + Instant.ofEpochMilli(now).atZone(ZoneOffset.UTC).toLocalDate() + ".fgcbak"
}
