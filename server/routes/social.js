const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const pool = require('../config/db');

// @route   POST api/social/posts
// @desc    Create a post (share a run)
// @access  Private
router.post('/posts', auth, async (req, res) => {
  const { runId, caption } = req.body;
  try {
    const post = await pool.query(
      'INSERT INTO posts (user_id, run_id, caption, created_at) VALUES ($1, $2, $3, NOW()) RETURNING *',
      [req.user.id, runId, caption]
    );
    res.json(post.rows[0]);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

// @route   GET api/social/feed
// @desc    Get social feed
// @access  Private
router.get('/feed', auth, async (req, res) => {
  try {
    const feed = await pool.query(
      `SELECT p.*, u.username, r.distance, r.duration, 
       (SELECT COUNT(*) FROM likes WHERE post_id = p.id) as likes,
       (SELECT COUNT(*) FROM comments WHERE post_id = p.id) as comments,
       EXISTS (SELECT 1 FROM likes WHERE post_id = p.id AND user_id = $1) as is_liked
       FROM posts p 
       JOIN users u ON p.user_id = u.id 
       LEFT JOIN runs r ON p.run_id = r.id 
       ORDER BY p.created_at DESC LIMIT 50`,
      [req.user.id]
    );
    
    // Fetch comments for each post
    const feedWithComments = await Promise.all(
      feed.rows.map(async (post) => {
        let commentsRes = null;
        
        try {
          // Try new schema first (post_id, text columns)
          commentsRes = await pool.query(
            `SELECT c.id, c.user_id, c.post_id, c.text as comment_text, c.text, c.created_at, u.username 
             FROM comments c 
             JOIN users u ON c.user_id = u.id 
             WHERE c.post_id = $1 
             ORDER BY c.created_at ASC 
             LIMIT 10`,
            [post.id]
          );
        } catch (err) {
          // Try old schema (run_id, comment_text columns)
          console.log('Trying old schema for feed comments...');
          commentsRes = await pool.query(
            `SELECT c.id, c.user_id, c.run_id as post_id, c.comment_text as comment_text, c.comment_text as text, c.created_at, u.username 
             FROM comments c 
             JOIN users u ON c.user_id = u.id 
             WHERE c.run_id = $1 
             ORDER BY c.created_at ASC 
             LIMIT 10`,
            [post.id]
          );
        }
        
        return {
          ...post,
          commentsList: commentsRes.rows
        };
      })
    );
    
    res.json(feedWithComments);
  } catch (err) {
    console.error('GET /social/feed error:', err.message);
    res.status(500).json({ msg: 'Server Error', error: err.message });
  }
});

// @route   POST api/social/like/:postId
// @desc    Like a post
// @access  Private
router.post('/like/:postId', auth, async (req, res) => {
  try {
    await pool.query(
      'INSERT INTO likes (user_id, post_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [req.user.id, req.params.postId]
    );
    res.json({ msg: 'Post liked' });
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

// @route   DELETE api/social/like/:postId
// @desc    Unlike a post
// @access  Private
router.delete('/like/:postId', auth, async (req, res) => {
  try {
    await pool.query('DELETE FROM likes WHERE user_id = $1 AND post_id = $2', [
      req.user.id,
      req.params.postId,
    ]);
    res.json({ msg: 'Post unliked' });
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

// @route   POST api/social/comment/:postId
// @desc    Comment on a post
// @access  Private
router.post('/comment/:postId', auth, async (req, res) => {
  const { text } = req.body;
  const postId = parseInt(req.params.postId, 10);
  
  if (!text || isNaN(postId)) {
    return res.status(400).json({ msg: 'Text and valid postId required' });
  }
  
  try {
    // First, ensure the comments table has the correct columns
    // Try inserting with post_id and text columns (new schema)
    let comment = null;
    let commentId = null;
    
    try {
      const result = await pool.query(
        `INSERT INTO comments (user_id, post_id, text, created_at) 
         VALUES ($1, $2, $3, NOW()) 
         RETURNING id, user_id, post_id, text, created_at`,
        [req.user.id, postId, text]
      );
      comment = result.rows[0];
      commentId = comment.id;
    } catch (err) {
      // If that fails, try with run_id and comment_text (old schema)
      console.log('Trying old schema for comments...', err.message);
      try {
        const result = await pool.query(
          `INSERT INTO comments (user_id, run_id, comment_text, created_at) 
           VALUES ($1, $2, $3, NOW()) 
           RETURNING id, user_id, run_id as post_id, comment_text as text, created_at`,
          [req.user.id, postId, text]
        );
        comment = result.rows[0];
        commentId = comment.id;
        console.log('✅ Comment saved with old schema:', comment);
      } catch (oldErr) {
        console.error('❌ Old schema also failed:', oldErr.message);
        throw oldErr;
      }
    }
    
    // Fetch the username for the response
    const userRes = await pool.query('SELECT username FROM users WHERE id = $1', [req.user.id]);
    const username = userRes.rows[0]?.username || 'Unknown';
    
    // Return comment with full data
    res.json({
      id: comment.id,
      user_id: comment.user_id,
      post_id: comment.post_id,
      text: comment.text,
      comment_text: comment.text,
      created_at: comment.created_at,
      username: username
    });
  } catch (err) {
    console.error('POST /social/comment error:', err.message);
    console.error('Post ID:', postId, 'User:', req.user.id, 'Text:', text);
    res.status(500).json({ 
      msg: 'Server Error', 
      error: err.message,
      details: 'Failed to add comment. Please check the database schema.'
    });
  }
});

// @route   GET api/social/comments/:postId
// @desc    Get comments for a post
// @access  Public
router.get('/comments/:postId', async (req, res) => {
  try {
    const postId = parseInt(req.params.postId, 10);
    
    let result = null;
    
    // Try new schema first (with post_id and text columns)
    // Use NULLIF to treat empty strings as NULL, then COALESCE to fall back to comment_text
    try {
      result = await pool.query(
        `SELECT c.id, c.user_id, COALESCE(c.post_id, c.run_id) as post_id, 
                COALESCE(NULLIF(c.text, ''), c.comment_text) as text, 
                c.created_at, u.username 
         FROM comments c 
         JOIN users u ON c.user_id = u.id 
         WHERE (c.post_id = $1 OR c.run_id = $1) 
         ORDER BY c.created_at DESC`,
        [postId]
      );
    } catch (newSchemaErr) {
      // Fall back to old schema (run_id and comment_text only)
      console.log('Trying old schema for comments...', newSchemaErr.message);
      try {
        result = await pool.query(
          `SELECT c.id, c.user_id, c.run_id as post_id, 
                  c.comment_text as text, 
                  c.created_at, u.username 
           FROM comments c 
           JOIN users u ON c.user_id = u.id 
           WHERE c.run_id = $1 
           ORDER BY c.created_at DESC`,
          [postId]
        );
        console.log(`📥 Fetched ${result.rows.length} comments for post ${postId}:`, result.rows.map(c => ({ id: c.id, text: c.text?.substring(0, 20) })));
      } catch (oldSchemaErr) {
        // If both fail, return empty array
        console.log('Both schemas failed for comments:', oldSchemaErr.message);
        result = { rows: [] };
      }
    }
    
    res.json(result.rows);
  } catch (err) {
    console.error('GET /social/comments error:', err.message);
    res.status(500).json({ msg: 'Server Error', error: err.message });
  }
});

// @route   PUT api/social/comments/:commentId
// @desc    Update a comment
// @access  Private
router.put('/comments/:commentId', auth, async (req, res) => {
  const { text } = req.body;
  const commentId = parseInt(req.params.commentId, 10);
  
  if (!text || isNaN(commentId)) {
    return res.status(400).json({ msg: 'Text and valid commentId required' });
  }
  
  try {
    // Check if comment exists and belongs to user
    const comment = await pool.query('SELECT * FROM comments WHERE id = $1', [commentId]);
    
    if (comment.rows.length === 0) {
      return res.status(404).json({ msg: 'Comment not found' });
    }
    
    if (String(comment.rows[0].user_id) !== String(req.user.id)) {
      // Log unauthorized access attempt
      await pool.query(
        `INSERT INTO security_events (user_id, event_type, ip_address, details)
         VALUES ($1, 'unauthorized_access', $2, $3)`,
        [req.user.id, req.ip, JSON.stringify({
          type: 'comment_edit',
          commentId: commentId,
          commentOwner: comment.rows[0].user_id,
          attempt: 'IDOR'
        })]
      );
      
      return res.status(403).json({ msg: 'Access denied. You do not own this comment.' });
    }

    let updatedComment = null;
    
    // Try new schema first (text column)
    try {
      updatedComment = await pool.query(
        'UPDATE comments SET text = $1, created_at = NOW() WHERE id = $2 RETURNING id, user_id, post_id, text, created_at',
        [text, commentId]
      );
    } catch (newSchemaErr) {
      // Fall back to old schema (comment_text column)
      console.log('Trying old schema for comment update...', newSchemaErr.message);
      updatedComment = await pool.query(
        'UPDATE comments SET comment_text = $1, created_at = NOW() WHERE id = $2 RETURNING id, user_id, run_id as post_id, comment_text as text, created_at',
        [text, commentId]
      );
    }
    
    // Get username for the updated comment - return both text and comment_text for compatibility
    const commentWithUser = await pool.query(
      `SELECT c.id, c.user_id, COALESCE(c.post_id, c.run_id) as post_id, 
              COALESCE(c.text, c.comment_text) as text,
              COALESCE(c.text, c.comment_text) as comment_text, 
              c.created_at, u.username 
       FROM comments c JOIN users u ON c.user_id = u.id 
       WHERE c.id = $1`,
      [commentId]
    );
    
    res.json(commentWithUser.rows[0]);
  } catch (err) {
    console.error('PUT /social/comments error:', err.message);
    res.status(500).json({ msg: 'Server Error', error: err.message });
  }
});

// @route   DELETE api/social/comments/:commentId
// @desc    Delete a comment
// @access  Private
router.delete('/comments/:commentId', auth, async (req, res) => {
  const commentId = parseInt(req.params.commentId, 10);
  
  // Validate commentId
  if (isNaN(commentId) || commentId <= 0) {
    return res.status(400).json({ msg: 'Invalid comment ID' });
  }
  
  try {
    // Check if comment exists and belongs to user
    const comment = await pool.query('SELECT user_id FROM comments WHERE id = $1', [commentId]);
    
    if (comment.rows.length === 0) {
      return res.status(404).json({ msg: 'Comment not found' });
    }
    
    if (String(comment.rows[0].user_id) !== String(req.user.id)) {
      // Log unauthorized access attempt
      await pool.query(
        `INSERT INTO security_events (user_id, event_type, ip_address, details)
         VALUES ($1, 'unauthorized_access', $2, $3)`,
        [req.user.id, req.ip, JSON.stringify({
          type: 'comment_delete',
          commentId: commentId,
          commentOwner: comment.rows[0].user_id,
          attempt: 'IDOR'
        })]
      );
      
      return res.status(403).json({ msg: 'Access denied. You do not own this comment.' });
    }

    const result = await pool.query('DELETE FROM comments WHERE id = $1 RETURNING id', [commentId]);
    
    console.log(`✅ Comment ${commentId} deleted by user ${req.user.id}`);
    
    res.json({ 
      msg: 'Comment deleted successfully',
      deletedCommentId: result.rows[0]?.id 
    });
  } catch (err) {
    console.error('❌ DELETE /social/comments error:', {
      error: err.message,
      code: err.code,
      commentId,
      userId: req.user.id
    });
    res.status(500).json({ 
      msg: 'Server Error',
      error: err.message,
      errorCode: err.code
    });
  }
});

// @route   PUT api/social/posts/:postId
// @desc    Update a post
// @access  Private
router.put('/posts/:postId', auth, async (req, res) => {
  const { caption } = req.body;
  try {
    // Check if post exists and belongs to user
    const post = await pool.query('SELECT * FROM posts WHERE id = $1', [req.params.postId]);
    
    if (post.rows.length === 0) {
      return res.status(404).json({ msg: 'Post not found' });
    }
    
    if (String(post.rows[0].user_id) !== String(req.user.id)) {
      // Log unauthorized access attempt
      await pool.query(
        `INSERT INTO security_events (user_id, event_type, ip_address, details)
         VALUES ($1, 'unauthorized_access', $2, $3)`,
        [req.user.id, req.ip, JSON.stringify({
          type: 'post_edit',
          postId: req.params.postId,
          postOwner: post.rows[0].user_id,
          attempt: 'IDOR'
        })]
      );
      
      return res.status(403).json({ msg: 'Access denied. You do not own this post.' });
    }

    const updatedPost = await pool.query(
      'UPDATE posts SET caption = $1 WHERE id = $2 RETURNING *',
      [caption, req.params.postId]
    );
    res.json(updatedPost.rows[0]);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

// @route   DELETE api/social/posts/:postId
// @desc    Delete a post
// @access  Private
router.delete('/posts/:postId', auth, async (req, res) => {
  const postId = parseInt(req.params.postId, 10);
  
  // Validate postId
  if (isNaN(postId) || postId <= 0) {
    return res.status(400).json({ msg: 'Invalid post ID' });
  }
  
  try {
    // Check if post exists and belongs to user
    const post = await pool.query('SELECT user_id FROM posts WHERE id = $1', [postId]);
    
    if (post.rows.length === 0) {
      return res.status(404).json({ msg: 'Post not found' });
    }
    
    if (post.rows[0].user_id !== req.user.id) {
      return res.status(403).json({ msg: 'Not authorized to delete this post' });
    }

    // Delete associated comments and likes first
    await pool.query('DELETE FROM comments WHERE post_id = $1', [postId]);
    await pool.query('DELETE FROM likes WHERE post_id = $1', [postId]);
    
    // Delete the post
    const result = await pool.query('DELETE FROM posts WHERE id = $1 RETURNING id', [postId]);
    
    console.log(`✅ Post ${postId} deleted by user ${req.user.id}`);
    
    res.json({ 
      msg: 'Post deleted successfully',
      deletedPostId: result.rows[0]?.id 
    });
  } catch (err) {
    console.error('❌ DELETE /social/posts error:', {
      error: err.message,
      code: err.code,
      postId,
      userId: req.user.id
    });
    res.status(500).json({ 
      msg: 'Server Error',
      error: err.message,
      errorCode: err.code
    });
  }
});

module.exports = router;