package io.github.diaslamka.freegames

import io.github.diaslamka.freegames.data.Install
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Une mise a jour signee avec une nouvelle cle est legitime quand sa chaine de rotation (APK Signature Scheme v3)
 * prouve qu'elle descend de la cle installee : Android l'accepte alors. L'appli doit en faire autant, sinon
 * son propre controle refuse la premiere version signee avec la nouvelle cle. Toute autre cle reste refusee.
 */
class SigningTest {
    private fun cert(vararg b: Int) = b.map { it.toByte() }
    private val old = cert(1, 1, 1)
    private val next = cert(2, 2, 2)
    private val stranger = cert(9, 9, 9)

    @Test
    fun theSameKeyIsAccepted() {
        assertTrue(Install.signersAccepted(setOf(old), setOf(old), null))
    }

    @Test
    fun aRotatedKeyIsAcceptedWhenItsChainGoesBackToTheInstalledOne() {
        // La cle courante de l'APK est la nouvelle ; son historique contient l'ancienne, celle de l'appli installee.
        assertTrue(Install.signersAccepted(theirs = setOf(next), mine = setOf(old), history = setOf(old, next)))
    }

    @Test
    fun anotherKeyIsRefusedWithoutAChainOrWithAChainThatDoesNotContainTheInstalledOne() {
        assertFalse(Install.signersAccepted(setOf(stranger), setOf(old), null))
        assertFalse(Install.signersAccepted(setOf(stranger), setOf(old), setOf(stranger)))
        // Une chaine qui commence ailleurs ne prouve rien.
        assertFalse(Install.signersAccepted(setOf(next), setOf(old), setOf(stranger, next)))
    }

    @Test
    fun whatTheSystemCannotReadIsLeftToTheSystem() {
        assertTrue(Install.signersAccepted(null, setOf(old), null))
        assertTrue(Install.signersAccepted(setOf(old), null, null))
        assertTrue(Install.signersAccepted(emptySet(), setOf(old), null))
        assertTrue(Install.signersAccepted(setOf(old), emptySet(), null))
    }
}
